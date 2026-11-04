const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

if (!process.env.TEST_DATABASE_URL) {
  test(
    "Database integration suite (set TEST_DATABASE_URL to run)",
    { skip: true },
    () => {},
  );
} else {
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let server, pool, base, driver, passenger, stranger, vehicle;
  const future = () => new Date(Date.now() + 86400000).toISOString();
  async function request(
    path,
    { method = "GET", body, cookie, headers = {} } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function register(name) {
    const response = await request("/api/auth/register", {
      method: "POST",
      body: {
        fullName: name,
        email: name.toLowerCase() + "@example.test",
        password: "Test-password-123!",
      },
    });
    assert.equal(response.status, 201);
    assert.match(response.cookie, /routeng_token=/);
    return { ...response.data.user, cookie: response.cookie };
  }
  async function createRide(seats = 3) {
    const response = await request("/api/rides", {
      method: "POST",
      cookie: driver.cookie,
      body: {
        origin: "Lagos",
        destination: "Ibadan",
        pickupPoint: "Test public car park",
        departureAt: future(),
        seatsTotal: seats,
        priceNaira: 3500,
        vehicleId: vehicle,
      },
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.ride;
  }
  const book = (ride, person = passenger, seats = 1) =>
    request(`/api/rides/${ride.id}/book`, {
      method: "POST",
      cookie: person.cookie,
      body: { seats },
    });
  const status = (booking, state, person) =>
    request(`/api/bookings/${booking.id}/status`, {
      method: "PATCH",
      cookie: person.cookie,
      body: { status: state },
    });

  before(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = "test-only-secret-that-is-long-enough";
    const module = require("../src/server");
    pool = module.pool;
    await pool.query(
      fs.readFileSync(
        require("node:path").join(__dirname, "../db/schema.sql"),
        "utf8",
      ),
    );
    server = await new Promise((resolve) => {
      const s = module.app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    driver = await register("Driver");
    passenger = await register("Passenger");
    stranger = await register("Stranger");
    const v = await request("/api/vehicles", {
      method: "POST",
      cookie: driver.cookie,
      body: { makeModel: "Toyota Corolla", seats: 4 },
    });
    assert.equal(v.status, 201);
    vehicle = v.data.vehicle.id;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  test("health, authentication, validation and origin checks", async () => {
    assert.equal((await request("/api/health")).status, 200);
    assert.equal((await request("/api/bookings/me")).status, 401);
    assert.equal((await request("/api/rides/not-a-uuid")).status, 400);
    assert.equal(
      (
        await request("/api/auth/login", {
          method: "POST",
          body: { email: "driver@example.test", password: "wrong-password" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/api/auth/logout", {
          method: "POST",
          headers: { Origin: "https://other.example" },
        })
      ).status,
      403,
    );
    const me = await request("/api/auth/me", { cookie: driver.cookie });
    assert.equal(me.data.user.id, driver.id);
    assert.equal(me.data.user.password_hash, undefined);
  });
  test("ride search, capacity, ownership and future departure validation", async () => {
    const ride = await createRide();
    const found = await request("/api/rides?origin=Lagos&destination=Ibadan");
    assert.ok(found.data.rides.some((r) => r.id === ride.id));
    const own = await request("/api/rides/me/published", {
      cookie: driver.cookie,
    });
    assert.ok(own.data.rides.some((r) => r.id === ride.id));
    const body = {
      origin: "Lagos",
      destination: "Ibadan",
      pickupPoint: "Public park",
      departureAt: future(),
      seatsTotal: 5,
      priceNaira: 5000,
      vehicleId: vehicle,
    };
    assert.equal(
      (
        await request("/api/rides", {
          method: "POST",
          cookie: driver.cookie,
          body,
        })
      ).status,
      400,
    );
    body.seatsTotal = 2;
    body.departureAt = new Date(0).toISOString();
    assert.equal(
      (
        await request("/api/rides", {
          method: "POST",
          cookie: driver.cookie,
          body,
        })
      ).status,
      400,
    );
    body.departureAt = future();
    assert.equal(
      (
        await request("/api/rides", {
          method: "POST",
          cookie: stranger.cookie,
          body,
        })
      ).status,
      403,
    );
  });
  test("seat request reserves inventory and duplicate request is rejected", async () => {
    const ride = await createRide();
    const first = await book(ride, passenger, 2);
    assert.equal(first.status, 201);
    assert.equal(first.data.booking.amountNaira, 7000);
    assert.equal((await book(ride)).status, 409);
    const updated = await request("/api/rides/" + ride.id);
    assert.equal(updated.data.ride.seatsAvailable, 1);
    assert.equal((await book(ride, driver)).status, 400);
  });
  test("parallel requests cannot oversell the final seat", async () => {
    const ride = await createRide(1);
    const results = await Promise.all([book(ride), book(ride, stranger)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const state = await request("/api/rides/" + ride.id);
    assert.equal(state.data.ride.seatsAvailable, 0);
    assert.equal(state.data.ride.status, "FULL");
  });
  test("only the driver can accept and unrelated users cannot alter bookings", async () => {
    const ride = await createRide();
    const b = (await book(ride)).data.booking;
    assert.equal((await status(b, "ACCEPTED", passenger)).status, 403);
    assert.equal((await status(b, "CANCELLED", stranger)).status, 403);
    assert.equal((await status(b, "CANCELLED", driver)).status, 403);
    assert.equal((await status(b, "ACCEPTED", driver)).status, 200);
    assert.equal((await status(b, "REJECTED", driver)).status, 409);
    assert.equal((await status(b, "COMPLETED", driver)).status, 400);
  });
  test("cancellation restores seats exactly once and permits rebooking", async () => {
    const ride = await createRide(1);
    const b = (await book(ride)).data.booking;
    assert.equal((await status(b, "CANCELLED", passenger)).status, 200);
    assert.equal((await status(b, "CANCELLED", passenger)).status, 409);
    const state = await request("/api/rides/" + ride.id);
    assert.equal(state.data.ride.seatsAvailable, 1);
    assert.equal(state.data.ride.status, "OPEN");
    assert.equal((await book(ride)).status, 201);
  });
  test("driver cancellation cancels full ride and notifies passengers", async () => {
    const ride = await createRide(1);
    const b = (await book(ride)).data.booking;
    const cancelled = await request("/api/rides/" + ride.id, {
      method: "DELETE",
      cookie: driver.cookie,
    });
    assert.equal(cancelled.status, 200);
    const state = await request("/api/rides/" + ride.id);
    assert.equal(state.data.ride.status, "CANCELLED");
    const bookings = await request("/api/bookings/me", {
      cookie: passenger.cookie,
    });
    assert.equal(
      bookings.data.bookings.find((x) => x.id === b.id).status,
      "CANCELLED",
    );
    const notices = await request("/api/notifications", {
      cookie: passenger.cookie,
    });
    assert.ok(
      notices.data.notifications.some((n) => n.title === "Ride cancelled"),
    );
    assert.equal((await status(b, "ACCEPTED", driver)).status, 409);
  });
  test("invalid booking attempts release database transactions", async () => {
    const ride = { id: randomUUID() };
    for (let i = 0; i < 12; i++) assert.equal((await book(ride)).status, 404);
    const active = await admin.query(
      `SELECT count(*) FROM pg_stat_activity WHERE state='idle in transaction' AND query LIKE '%rides%'`,
    );
    assert.equal(Number(active.rows[0].count), 0);
    assert.equal((await request("/api/health")).status, 200);
  });
  test("review requires a completed booking and updates rating only once", async () => {
    const ride = await createRide();
    const b = (await book(ride)).data.booking;
    const review = () =>
      request("/api/rides/" + ride.id + "/reviews", {
        method: "POST",
        cookie: passenger.cookie,
        body: { rating: 5, comment: "Good journey." },
      });
    assert.equal((await review()).status, 400);
    await status(b, "ACCEPTED", driver);
    await pool.query(
      "UPDATE rides SET departure_at=NOW()-interval '1 hour' WHERE id=$1",
      [ride.id],
    );
    assert.equal((await status(b, "COMPLETED", driver)).status, 200);
    assert.equal((await review()).status, 201);
    assert.equal((await review()).status, 409);
    const result = await request("/api/rides/" + ride.id);
    assert.equal(result.data.ride.driver.rating, 5);
    assert.equal(result.data.ride.driver.totalRatings, 1);
  });
  test("payment is explicitly unavailable without provider configuration", async () => {
    const result = await request("/api/payments/initialize", {
      method: "POST",
      cookie: passenger.cookie,
      body: { bookingId: randomUUID() },
    });
    assert.equal(result.status, 503);
  });
  test("signed payment webhooks reject forgery and require the exact amount", async () => {
    const key = "test-only-paystack-key";
    process.env.PAYSTACK_SECRET_KEY = key;
    try {
      const ride = await createRide();
      const booking = (await book(ride)).data.booking;
      const reference = "TEST-" + randomUUID();
      await pool.query(
        "UPDATE bookings SET payment_reference=$1,payment_status='PENDING' WHERE id=$2",
        [reference, booking.id],
      );
      const body = {
        event: "charge.success",
        data: {
          reference,
          currency: "NGN",
          status: "success",
          amount: booking.amountKobo,
        },
      };
      assert.equal(
        (
          await request("/api/payments/webhook", {
            method: "POST",
            body,
            headers: { "x-paystack-signature": "bad" },
          })
        ).status,
        401,
      );
      async function webhook(amount) {
        const event = { ...body, data: { ...body.data, amount } };
        const signature = require("node:crypto")
          .createHmac("sha512", key)
          .update(JSON.stringify(event))
          .digest("hex");
        return request("/api/payments/webhook", {
          method: "POST",
          body: event,
          headers: { "x-paystack-signature": signature },
        });
      }
      assert.equal((await webhook(1)).status, 200);
      assert.equal(
        (
          await pool.query("SELECT payment_status FROM bookings WHERE id=$1", [
            booking.id,
          ])
        ).rows[0].payment_status,
        "PENDING",
      );
      assert.equal((await webhook(booking.amountKobo)).status, 200);
      assert.equal((await webhook(booking.amountKobo)).status, 200);
      assert.equal(
        (
          await pool.query("SELECT payment_status FROM bookings WHERE id=$1", [
            booking.id,
          ])
        ).rows[0].payment_status,
        "PAID",
      );
    } finally {
      delete process.env.PAYSTACK_SECRET_KEY;
    }
  });
  test("payment verification checks ownership and provider amount and currency", async () => {
    process.env.PAYSTACK_SECRET_KEY = "test-only-paystack-key";
    const realFetch = global.fetch;
    try {
      const ride = await createRide();
      const booking = (await book(ride)).data.booking;
      assert.equal(
        (
          await request("/api/payments/initialize", {
            method: "POST",
            cookie: passenger.cookie,
            body: { bookingId: booking.id },
          })
        ).status,
        409,
      );
      const reference = "TEST-" + randomUUID();
      await pool.query(
        "UPDATE bookings SET payment_reference=$1,payment_status='PENDING' WHERE id=$2",
        [reference, booking.id],
      );
      let amount = 1,
        currency = "NGN";
      global.fetch = (url, opts) =>
        String(url).startsWith("https://api.paystack.co/")
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  status: true,
                  data: { status: "success", reference, amount, currency },
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            )
          : realFetch(url, opts);
      assert.equal(
        (
          await request("/api/payments/verify/" + reference, {
            cookie: stranger.cookie,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request("/api/payments/verify/" + reference, {
            cookie: passenger.cookie,
          })
        ).status,
        409,
      );
      amount = booking.amountKobo;
      currency = "USD";
      assert.equal(
        (
          await request("/api/payments/verify/" + reference, {
            cookie: passenger.cookie,
          })
        ).status,
        409,
      );
      currency = "NGN";
      const paid = await request("/api/payments/verify/" + reference, {
        cookie: passenger.cookie,
      });
      assert.equal(paid.status, 200);
      assert.equal(paid.data.paid, true);
    } finally {
      global.fetch = realFetch;
      delete process.env.PAYSTACK_SECRET_KEY;
    }
  });
}
