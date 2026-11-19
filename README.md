# DCC Assignment

Starter project using React and Express:

- `frontend/` — React with Vite
- `backend/` — Node.js and Express

For local testing, the backend stores users in `backend/data/users.json` instead of MongoDB. This file is created automatically and ignored by Git.

Signed-in users can browse other profiles sharing their pincode and exchange private one-to-one messages in real time. Messages are stored locally in `backend/data/messages.json`.

The app includes separate email/password signup and signin for neighborhood and business accounts. Business profiles include a category, contact details, address, description, services, opening hours, website, and up to five photos. Business owners can manage a product catalog with photos, names, prices, descriptions, optional stock tracking, and ongoing or time-limited percentage discounts. Stock tracking can be disabled for made-to-order or unlimited items; when enabled, orders are checked and deducted atomically to prevent overselling. Customers in the same pincode can browse visible businesses' available and unavailable products, expand descriptions, see active discounts, limited-time offer timers, and tracked stock, and keep a separate cart for each business and customer in their browser. Placing a cart deal snapshots the selected products, quantities, and current prices into an automatically accepted deal for both parties. The order details appear in the deal center, where either party can open the item list and continue in the deal chat. Businesses can control whether they appear in their area's directory and can reply to customer messages in their separate business inbox. Neighborhood users access business discovery, chats, and active deals from one Business navigation section with its own sub-navigation. Their last top-level section (Business or Community) is remembered in an HTTP-only `last_section` cookie and restored on sign-in. Either side can make a written deal proposal; the other side can accept or decline it, and accepted deals have a separate chat and can be marked fulfilled. Both account types have an Active deals section with the latest deal message, direct replies, and a shortcut to the full deal conversation; deal lists can also be filtered to show all, active, or fulfilled deals. Customers who have at least one accepted or fulfilled deal with a business can submit or update one star rating and comment for it. Business directory users can view and filter reviews by star rating, and business owners have a Reviews section showing their average score, rating breakdown, and customer comments.

Service providers have a separate account type with an India-focused searchable catalog of more than 100 services, including household, repair, care, tutoring, transport, and professional services. Providers choose multiple offerings, can add a custom service, and enter a required description plus an optional usual price for each service. They are listed only to neighborhood users with the same six-digit pincode. Providers can optionally share their location, add expertise and general offering details, chat with customers, and create service deals. Customers have a Services section to browse/search service tiles, view provider cards with each service's details and typical price, search providers by name or expertise, and select the specific service for messages and deals. Each service message and deal displays its service context to both participants. Customers with an accepted or fulfilled deal for a particular provider and service can submit or update a rating and comment for that service; customers can filter its reviews by star rating. Each service displays its own average and review count, and providers have a Reviews section with separate rating breakdowns and comments for every service they offer.

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

Neighborhood signup requires a name, email, password, and pincode. Address, job, school/college/workplace, and interests are optional. Business signup requires a business name, category, contact name and number, email, password, address, and pincode. Service provider signup requires a name, email, password, Indian mobile number, six-digit pincode, and at least one catalog service. Passwords are hashed before storage, and each account type uses an HTTP-only session cookie.

The JSON file store is for single-machine development/testing only. It is not a production database and should not be used by multiple server instances. User, business, service-provider, connection, personal-message, business-message, service-message, business-deal, business-review, service-review, business-product, and uploaded image data are stored locally in the ignored `backend/data/` folder. Customer carts are stored in browser local storage and are scoped by customer and business.
