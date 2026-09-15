# AyushMitra

Digital Patient Intake System for SIH26047.

## Repository layout

- `frontend/` contains the static patient and doctor interface.
- `backend/` contains the Express/MongoDB API.

## Local run

Start the backend from `backend/` with `npm install` and `npm run dev`. Serve the `frontend/` folder using a static-server extension or local static-server tool. The frontend defaults to `http://localhost:5000/api`.

## Deploy

Deploy `backend/` as a Node 20+ service. In its host environment variables, set `MONGODB_URI`, `JWT_SECRET`, `REGISTRATION_SECRET`, `CLIENT_ORIGIN`, and `NODE_ENV=production`.

Deploy `frontend/` as a static site. After you know the public backend address, update `API_BASE` in `frontend/js/api-integration.js` to `https://your-backend-domain/api` before deploying the frontend. Do not commit `.env` files.
