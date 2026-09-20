const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGO_URI) {
  console.error('Missing MONGO_URI environment variable.');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET environment variable.');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient' },
  age: Number,
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  abha: { type: String, unique: true, sparse: true },
  abhaStatus: { type: String, enum: ['Verified', 'Pending', 'Not provided'], default: 'Not provided' },
  opdRoom: { type: String, default: 'Room 104' },
  otpSecret: String,
  otpExpiresAt: Date
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

const User = mongoose.model('User', userSchema);

const intakeRecordSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  token: { type: String, required: true, unique: true },
  chiefComplaint: { type: String, required: true },
  voiceTranscript: { type: String, default: '' },
  aiVoiceSummary: { type: String, default: '' },
  socratesDetails: { duration: String, location: String, severity: String },
  isRedFlag: { type: Boolean, default: false },
  status: { type: String, enum: ['Waiting', 'In Consultation', 'Completed'], default: 'Waiting' },
  opdDepartment: { type: String, default: 'General Medicine OPD' },
  assignedDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  documents: [{
    fileName: String,
    fileUrl: String,
    uploadedAt: { type: Date, default: Date.now },
    ocrExtractedData: mongoose.Schema.Types.Mixed
  }]
}, { timestamps: true });

const IntakeRecord = mongoose.model('IntakeRecord', intakeRecordSchema);

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Access denied. Token missing.' });
  }
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden access.' });
  }
  next();
};

app.get('/api/health', (req, res) => res.json({ success: true, service: 'AyushMitra', status: 'ok' }));

app.post('/api/auth/request-otp', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ success: false, message: 'Identifier is required.' });
    const user = await User.findOne({ $or: [{ mobile: identifier }, { abha: identifier }] });
    const otp = '123456';
    if (user) {
      user.otpSecret = otp;
      user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
    }
    res.json({ success: true, message: `Demo OTP for ${identifier}: 123456` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    if (!identifier || otp !== '123456') return res.status(400).json({ success: false, message: 'Invalid OTP code.' });
    let user = await User.findOne({ $or: [{ mobile: identifier }, { abha: identifier }] });
    if (!user) {
      user = await User.create({
        name: `Patient ${identifier.slice(-4)}`,
        mobile: identifier,
        password: 'default_password',
        role: 'patient',
        abha: `91-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
        abhaStatus: 'Verified'
      });
    }
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, mobile, age, gender, role, password, createAbha } = req.body;
    if (!name || !mobile || !password) return res.status(400).json({ success: false, message: 'Name, mobile and password are required.' });
    if (await User.findOne({ mobile })) return res.status(400).json({ success: false, message: 'Mobile already registered.' });
    const abhaId = createAbha
      ? `91-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`
      : undefined;
    const newUser = await User.create({ name, mobile, password, age, gender, role: role || 'patient', abha: abhaId, abhaStatus: createAbha ? 'Verified' : 'Pending' });
    const token = jwt.sign({ id: newUser._id, role: newUser.role, name: newUser.name }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ success: true, token, user: newUser });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/intake/submit', verifyToken, async (req, res) => {
  try {
    const { chiefComplaint, voiceTranscript, socratesDetails, isRedFlag, documents } = req.body;
    if (!chiefComplaint) return res.status(400).json({ success: false, message: 'Chief complaint is required.' });
    const prefix = Boolean(isRedFlag) ? 'E' : 'A';
    let tokenCode;
    let attempts = 0;
    do {
      tokenCode = `${prefix}-${Math.floor(100 + Math.random() * 900)}`;
      attempts++;
    } while (await IntakeRecord.exists({ token: tokenCode }) && attempts < 20);
    const newRecord = await IntakeRecord.create({
      patientId: req.user.id,
      token: tokenCode,
      chiefComplaint,
      voiceTranscript: voiceTranscript || '',
      aiVoiceSummary: `Chief Complaint: ${chiefComplaint}. Specifics: ${voiceTranscript || ''}`,
      socratesDetails: socratesDetails || {},
      isRedFlag: Boolean(isRedFlag),
      documents: documents || []
    });
    io.emit('queueUpdated', newRecord);
    res.status(201).json({ success: true, token: tokenCode, record: newRecord });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/intake/doctor-queue', verifyToken, authorizeRoles('doctor'), async (req, res) => {
  try {
    const queue = await IntakeRecord.find({ status: { $ne: 'Completed' } })
      .populate('patientId', 'name age gender mobile abha')
      .sort({ isRedFlag: -1, createdAt: 1 });
    res.json({ success: true, count: queue.length, queue });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.patch('/api/intake/status/:recordId', verifyToken, authorizeRoles('doctor'), async (req, res) => {
  try {
    const allowed = ['Waiting', 'In Consultation', 'Completed'];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
    const updated = await IntakeRecord.findByIdAndUpdate(req.params.recordId, { status: req.body.status }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: 'Record not found.' });
    io.emit('queueUpdated', updated);
    res.json({ success: true, record: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

io.on('connection', socket => console.log('Client connected:', socket.id));

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected Successfully for AyushMitra');
    server.listen(PORT, () => console.log(`AyushMitra server active on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
