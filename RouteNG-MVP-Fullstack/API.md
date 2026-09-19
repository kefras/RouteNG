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
- `PATCH /rides/:id`
- `DELETE /rides/:id`
- `GET /bookings/me`
- `GET /bookings/driver`
- `PATCH /bookings/:id/status`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `POST /rides/:id/reviews`

## Payments

Optional Paystack integration:

- `POST /payments/initialize` — `{ bookingId }`
- `GET /payments/verify/:reference`

Set `PAYSTACK_SECRET_KEY` in `.env`. For production, add a Paystack webhook endpoint and server-side reconciliation before treating a booking as paid.

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
