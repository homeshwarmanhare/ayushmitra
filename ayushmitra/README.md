# AyushMitra Prototype

Student SIH prototype: single-page frontend + Express/MongoDB backend.

## Run locally

1. Copy `.env.example` to `.env`.
2. Put your MongoDB Atlas URI and a strong JWT secret in `.env`.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:5000`.

Demo OTP: `123456`.

## Security

Never commit `.env` or database credentials to GitHub. The MongoDB password should be rotated if it has been exposed.
