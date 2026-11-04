# RouteNG API

Base URL: `/api`

Authentication uses an HTTP-only cookie named `routeng_token`.

## Public

- `GET /health`
- `GET /cities`
- `GET /rides?origin=Abuja&destination=Kaduna&date=2026-09-25&passengers=1`
- `GET /rides/:id`

## Authentication

- `POST /auth/register` — `{ fullName, email, phone?, password }`
- `POST /auth/login` — `{ email, password }`
- `POST /auth/logout`
- `GET /auth/me`

## User / driver

- `POST /vehicles`
- `GET /vehicles/me`
- `POST /rides`
- `GET /rides/me/published` — the current driver's journeys
- `PATCH /rides/:id`
- `DELETE /rides/:id`
- `GET /bookings/me`
- `GET /bookings/driver`
- `PATCH /bookings/:id/status`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `POST /rides/:id/book` — `{ seats, pickupPoint? }`; reserves seats pending driver acceptance
- `POST /rides/:id/reviews`

## Payments

Optional Paystack integration:

- `POST /payments/initialize` — `{ bookingId }`
- `GET /payments/verify/:reference`
- `POST /payments/webhook` — provider-only HMAC-SHA512 signed raw-body event

Set `PAYSTACK_SECRET_KEY` server-side and configure the webhook URL. Payment initialization requires an accepted booking. Verification is scoped to the current passenger and checks reference, NGN currency and exact amount. A signed `charge.success` webhook reconciles matching records idempotently. See README for payment-ledger, refund and operational work required before real-money launch.

Booking transitions: `PENDING → ACCEPTED | REJECTED | CANCELLED`; `ACCEPTED → CANCELLED | COMPLETED`. Only passengers cancel their bookings; drivers accept, reject or complete. Completion is allowed after departure. Other transitions return 409. `DELETE /rides/:id` cancels the driver's open/full future ride, active bookings and passenger notifications in one transaction. `PATCH /rides/:id` edits pickup, future departure and notes; it cannot bypass cancellation rules by setting status.

## Admin

- `GET /admin/stats`
- `GET /admin/users`
- `PATCH /admin/users/:id/verification` — `{ status: "UNVERIFIED" | "PENDING" | "VERIFIED" }`

## Example create ride

```json
{
  "origin": "Abuja",
  "destination": "Kaduna",
  "pickupPoint": "Jabi Lake Mall",
  "departureAt": "2026-09-25T08:00:00+01:00",
  "seatsTotal": 3,
  "priceNaira": 5000,
  "notes": "One medium luggage per passenger"
}
```
