# RouteNG

A Nigerian carpooling app with a responsive green and white interface, Express 5 API, and PostgreSQL 17 persistence. Inspired by the search-first experience of BlaBlaCar, with original RouteNG branding, copy, city illustrations and layouts. Existing travel photographs are reused from this repository.

## Run locally

Use Node.js 24 LTS and PostgreSQL 17 (or Docker Desktop).

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d postgres
npm run db:setup
npm start
```

Open http://localhost:4000. On macOS/Linux use `cp .env.example .env`.
If you already have PostgreSQL, set `DATABASE_URL` in `.env` and skip Docker.
The application serves `public/`; root-level HTML and the legacy `RouteNG-MVP-Fullstack/` directory are retained historical files, not the running frontend.

### Fully containerized development

```sh
docker compose --profile fullstack up --build -d
docker compose --profile fullstack exec web node src/seed.js
```

The Compose services bind host ports to loopback only. Docker must be running. The container image is provided; its build was not verified in the current environment because Docker Desktop's daemon was unavailable.

### Development data

`npm run db:seed` adds sample journeys for the next seven days and never overwrites passwords. Rerun to add upcoming dates. Sample fares and verified demo profiles are fictional testing data. Seeding is disabled when `NODE_ENV=production`; it creates no administrator.

Demo driver: `daniel@routeng.ng` / `Password123!`. Another driver, `mary@routeng.ng`, uses the same development password and can book Daniel's rides. Use **Explore all rides** for upcoming journeys, or select tomorrow's date. Create an account through **Log in → Create an account** to test a new passenger.

## Implemented experience

- Responsive desktop, tablet and mobile homepage, route cards, city suggestions, date and passenger selection, swap locations, FAQs and safety information.
- Database-backed ride search with departure/price/rating sorting and verification filter.
- Ride details, seat selector, calculated total and clear pending confirmation.
- Registration, login, logout, bcrypt password hashing and HTTP-only cookie sessions.
- Vehicle creation and ride publishing with Nigerian cities, WAT departures, capacity and ownership validation.
- Passenger booking history, cancellation, trip-detail sharing and reviews after completion.
- Driver's published rides, passenger requests, accept/decline controls and post-departure completion.
- Notifications and profile information.
- PostgreSQL transactions and consistent ride-first row locks protect seat inventory. Cancellation restores seats once; a cancelled passenger can rebook. Driver cancellation closes active bookings and notifies passengers.
- Optional Paystack initialization, authenticated verification and signed webhook reconciliation. No card details are collected by RouteNG.
- Security headers and CSP, request-origin checks, rate limits, server validation, escaped user content and production secret checks.
- Existing administrator API for verification and basic statistics. There is no administrator web dashboard yet.

## Tests

`npm run check` checks JavaScript syntax. The integration suite uses an isolated, randomly named schema and drops only that schema on completion. It requires a PostgreSQL role allowed to create schemas.

```powershell
$env:TEST_DATABASE_URL='postgresql://routeng:routeng@localhost:5432/routeng'
npm test
```

Without `TEST_DATABASE_URL`, integration tests explicitly skip. GitHub Actions provisions PostgreSQL and runs them on pushes and pull requests.

The 12 integration tests cover authentication, origin rejection, ride validation and search, vehicle ownership/capacity, concurrent final-seat reservations, duplicate requests, booking permissions, repeated cancellation, rebooking, driver cancellation/notifications, transaction cleanup, completed-trip reviews, unavailable payment configuration, signed webhook amount checks, and payment verification ownership/currency/amount checks. Provider responses are mocked; no real money is charged.

## Production deployment

Deploy the Node server with a managed PostgreSQL database. A static-only host cannot run this full-stack application. The Sites hosting runtime uses Cloudflare Workers and cannot directly run the existing Express/PostgreSQL process, so this version is delivered as a local full-stack app and deployable source rather than a static Site with nonfunctional APIs.

1. Set `NODE_ENV=production`, `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, `COOKIE_SECURE=true` and the exact HTTPS `FRONTEND_URL`.
2. Set `TRUST_PROXY=1` only behind a trusted single reverse proxy. The production server listens on `0.0.0.0` and the platform's `PORT`.
3. Install with `npm ci --omit=dev`, run `npm run db:migrate`, then `npm start`. Schema setup is repeatable and includes the active-booking uniqueness change; use a reviewed versioned migration process for subsequent production changes. Back up any existing database first.
4. Do not run the demo seed against a production database. Provision administrator access through a controlled database operation, not public registration.
5. Point health checks at `/api/health`, enable HTTPS, database backups and application monitoring.

Generate a secret locally with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and store it in the host's secret manager.

### Optional payments

Set `PAYSTACK_SECRET_KEY` server-side. Configure the provider webhook as `https://YOUR_DOMAIN/api/payments/webhook`. The callback returns to the frontend and verifies the reference with the server. Only an accepted booking can initialize payment; exact NGN amount and reference are checked before marking paid. Webhooks use the raw body and HMAC-SHA512, with idempotent updates. Pending payments can be verified by reference; avoid creating duplicate charges.

Before accepting real payments, validate the integration in Paystack test mode, add a payment-attempt ledger and scheduled reconciliation for network interruptions, and implement operator refund processing. Automatic refunds, payouts, disputes and charges for ride cancellation are not implemented. Paid cancelled bookings retain their paid status for refund handling; cancellation does not imply a refund has occurred.

## Remaining launch work

This is a working full-stack MVP, not a claim of a production transport operation. Live hosting, email/phone verification and password recovery, a real identity-verification provider, operator support tools, mapping/live location, production monitoring and backup operations, reviewed privacy/terms/refund policies, and real payment acceptance testing remain. Sample verification flags must not be treated as real identity checks. The preview help/privacy/terms screens explicitly identify what needs operator configuration.

See `API.md` for endpoint contracts.
