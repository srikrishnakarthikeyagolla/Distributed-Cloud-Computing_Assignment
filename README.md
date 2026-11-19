# DCC Assignment

Starter project using React and Express:

- `frontend/` — React with Vite
- `backend/` — Node.js and Express

For local testing, the backend stores users in `backend/data/users.json` instead of MongoDB. This file is created automatically and ignored by Git.

Signed-in users can browse other profiles sharing their pincode and exchange private one-to-one messages in real time. Messages are stored locally in `backend/data/messages.json`.

The app includes separate email/password signup and signin for neighborhood and business accounts. Business profiles include a category, contact details, address, description, services, opening hours, website, and up to five photos. Businesses can control whether they appear in their area's directory and can reply to customer messages in their separate business inbox. Neighborhood users access business discovery, chats, and active deals from one Business navigation section with its own sub-navigation. Their last top-level section (Business or Community) is remembered in an HTTP-only `last_section` cookie and restored on sign-in. Either side can make a written deal proposal; the other side can accept or decline it, and accepted deals have a separate chat and can be marked fulfilled. Both account types have an Active deals section with the latest deal message, direct replies, and a shortcut to the full deal conversation; deal lists can also be filtered to show all, active, or fulfilled deals.

Business location permission is requested only after the account holder chooses **Use my location**. If allowed, the business coordinates are saved to that business profile for later location features, and reverse geocoding can fill the pincode. A pincode can always be entered manually. Neighborhood accounts use location only to look up a pincode and do not store coordinates.

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

Neighborhood signup requires a name, email, password, and pincode. Address, job, school/college/workplace, and interests are optional. Business signup requires a business name, category, contact name and number, email, password, address, and pincode. Passwords are hashed before storage, and each account type uses an HTTP-only session cookie.

The JSON file store is for single-machine development/testing only. It is not a production database and should not be used by multiple server instances. User, business, connection, personal-message, business-message, business-deal, and uploaded image data are stored locally in the ignored `backend/data/` folder.
