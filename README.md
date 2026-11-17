# DCC Assignment

Starter project using the MERN stack:

- `frontend/` — React with Vite
- `backend/` — Node.js, Express, and Mongoose for MongoDB

## Requirements

- Node.js 20 LTS or 22 LTS (22 LTS recommended)
- MongoDB running locally, or a MongoDB Atlas connection string

## Run locally

1. In `backend/`, install dependencies and create your environment file:

   ```powershell
   cd backend
   npm install
   Copy-Item .env.example .env
   ```

   If needed, update `MONGODB_URI` in `.env` to your MongoDB connection string.

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
