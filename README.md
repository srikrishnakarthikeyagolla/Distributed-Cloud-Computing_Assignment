# DCC Assignment

Starter project using React and Express:

- `frontend/` — React with Vite
- `backend/` — Node.js and Express

For local testing, the backend stores users in `backend/data/users.json` instead of MongoDB. This file is created automatically and ignored by Git.

Signed-in users can browse other profiles sharing their pincode and exchange private one-to-one messages. Messages are stored locally in `backend/data/messages.json`; an open conversation refreshes every four seconds.

The starter includes email/password signup and signin, neighborhood profiles, and an optional Geoapify reverse-geocoding lookup for the required pincode. Browser location is requested only after the user chooses **Use my location**. Coordinates are used for that lookup and are not stored. A pincode can always be entered manually.

## Requirements

- Node.js 20 LTS or 22 LTS (22 LTS recommended)
- Node.js package installation access

## Run locally

1. In `backend/`, install dependencies and create your environment file:

   ```powershell
   cd backend
   npm install
   Copy-Item .env.example .env
   ```

   In `backend/.env`, set `JWT_SECRET` to a random secret of at least 32 characters. For example, generate one with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   To enable automatic pincode lookup, add your Geoapify key to `GEOAPIFY_API_KEY`. Keep `.env` private; it is ignored by Git. Without a Geoapify key, users can still enter their pincode manually.

2. Start the backend from `backend/`:

   ```powershell
   npm run dev
   ```

3. In a second terminal, install and start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

4. Open the local URL printed by Vite (usually `http://localhost:5173`).

The frontend proxies `/api` requests to the backend at `http://localhost:5000`.

Signup requires a name, email, password, and pincode. Address, job, school/college/workplace, and interests are optional. Passwords are hashed before storage; the session is kept in an HTTP-only cookie.

The JSON file store is for single-machine development/testing only. It is not a production database and should not be used by multiple server instances. User and message data are stored locally in the ignored `backend/data/` folder.
