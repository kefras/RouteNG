# RouteNG — Full-Stack MVP

A Nigerian carpooling / ride-sharing MVP inspired by the supplied BlaBlaCar reference, rebuilt with a real Node.js + Express + PostgreSQL backend while keeping the original HTML/CSS/JavaScript frontend.

## Included

- User registration/login/logout with HTTP-only JWT cookie
- Password hashing with bcrypt
- Nigerian city search
- Create, search, view, edit and cancel rides
- Vehicle management
- Seat-aware booking requests with PostgreSQL row locking
- Driver accept/reject/complete booking workflow
- Passenger cancellation
- Notifications
- Ratings/reviews after completed rides
- Admin user verification controls and basic statistics
- Security headers, CORS, rate limits and Zod validation
- Optional Paystack payment initialization/verification
- PostgreSQL migrations and demo seed data
- Docker Compose PostgreSQL setup

## Run locally

Requirements: Node.js 20+ and Docker Desktop.

```bash
docker compose up -d
copy .env.example .env
npm install
npm run db:setup
npm run dev
```

Open http://localhost:4000

On macOS/Linux, use `cp .env.example .env` instead of `copy`.

### Demo accounts

Seed creates six verified demo drivers. Their password is:

`Password123!`

Example email: `daniel@routeng.ng`

Change these credentials before any real deployment.

## Production checklist

- Use a strong random JWT_SECRET and COOKIE_SECURE=true behind HTTPS.
- Use a managed PostgreSQL database and encrypted backups.
- Add email/phone OTP verification and identity/KYC provider before showing users as verified.
- Add proper payment webhooks and reconciliation; never trust the browser for payment status.
- Add a map/geocoding provider and route-distance calculation.
- Add object storage for profile/vehicle documents if KYC is introduced.
- Add observability, structured logs, monitoring, CI/CD, secret management and automated backups.
- Add terms, privacy policy, community guidelines, cancellation/refund policy and emergency/safety workflows.
- Review Nigerian transport, payment, data-protection and consumer requirements with qualified local counsel before launch.


### Hero image asset
Place the supplied image file named `Naija travel1.png` inside the `public/` folder. The homepage hero now uses that image instead of the CSS road-trip illustration.
