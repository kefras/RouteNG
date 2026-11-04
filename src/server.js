const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const { z } = require("zod");
const { pool } = require("./db");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL)
  throw new Error("Production requires DATABASE_URL");
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
)
  throw new Error("Production requires a JWT_SECRET of at least 32 characters");
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.COOKIE_SECURE === "true",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use(
  cors({
    origin: process.env.FRONTEND_URL || `http://localhost:${PORT}`,
    credentials: true,
  }),
);
app.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
    const expected =
      process.env.FRONTEND_URL || req.protocol + "://" + req.get("host");
    if (req.headers.origin !== expected)
      return res.status(403).json({ error: "Request origin is not allowed" });
  }
  next();
});
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buffer) => {
      if (req.originalUrl === "/api/payments/webhook") req.rawBody = buffer;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(morgan("tiny"));
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const cities = [
  "Abuja",
  "Lagos",
  "Kaduna",
  "Kano",
  "Jos",
  "Makurdi",
  "Enugu",
  "Benin City",
  "Ibadan",
  "Ilorin",
  "Port Harcourt",
  "Zaria",
  "Minna",
  "Lokoja",
  "Lafia",
  "Onitsha",
  "Keffi",
];
const authSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(255),
  phone: z.string().min(7).max(30).optional(),
  password: z.string().min(8).max(72),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
});
const rideSchema = z.object({
  origin: z.string().min(2).max(100),
  destination: z.string().min(2).max(100),
  pickupPoint: z.string().min(2).max(180),
  departureAt: z.string().datetime({ offset: true }),
  seatsTotal: z.coerce.number().int().min(1).max(12),
  priceNaira: z.coerce.number().min(0).max(1000000),
  vehicleId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});
const bookingSchema = z.object({
  seats: z.coerce.number().int().min(1).max(12),
  pickupPoint: z.string().max(180).optional(),
});
const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});
const vehicleSchema = z.object({
  makeModel: z.string().min(2).max(120),
  plateNumber: z.string().max(30).optional(),
  color: z.string().max(50).optional(),
  year: z.coerce.number().int().min(1980).max(2100).optional(),
  seats: z.coerce.number().int().min(1).max(12),
});

function sign(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: "7d",
  });
}
function safeUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    verificationStatus: row.verification_status,
    avatarUrl: row.avatar_url,
    rating: Number(row.rating),
    totalRatings: row.total_ratings,
  };
}
function auth(required = true) {
  return async (req, res, next) => {
    try {
      const token =
        req.cookies.routeng_token ||
        (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) {
        if (required)
          return res.status(401).json({ error: "Authentication required" });
        return next();
      }
      const payload = jwt.verify(token, JWT_SECRET);
      const r = await pool.query("SELECT * FROM users WHERE id=$1", [
        payload.sub,
      ]);
      if (!r.rowCount)
        return res.status(401).json({ error: "User no longer exists" });
      req.user = safeUser(r.rows[0]);
      next();
    } catch (e) {
      if (required)
        return res.status(401).json({ error: "Invalid or expired session" });
      next();
    }
  };
}
function admin(req, res, next) {
  if (req.user?.role !== "ADMIN")
    return res.status(403).json({ error: "Admin access required" });
  next();
}
function validate(schema) {
  return (req, res, next) => {
    const p = schema.safeParse(req.body);
    if (!p.success)
      return res
        .status(400)
        .json({
          error: "Invalid input",
          details: p.error.issues.map((x) => ({
            field: x.path.join("."),
            message: x.message,
          })),
        });
    req.body = p.data;
    next();
  };
}
function handle(err, res) {
  console.error(err);
  return res.status(500).json({ error: "Something went wrong" });
}

app.use("/api", (req, res, next) => {
  const parts = req.path.split("/").filter(Boolean);
  if (
    ["rides", "bookings", "notifications"].includes(parts[0]) &&
    parts[1] &&
    parts[1] !== "me" &&
    parts[1] !== "driver" &&
    !z.string().uuid().safeParse(parts[1]).success
  )
    return res.status(400).json({ error: "Invalid resource ID" });
  next();
});
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "RouteNG API" });
  } catch (e) {
    res.status(503).json({ ok: false });
  }
});
app.get("/api/cities", (_req, res) => res.json({ cities }));

app.post("/api/auth/register", validate(authSchema), async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const r = await pool.query(
      "INSERT INTO users(full_name,email,phone,password_hash) VALUES($1,$2,$3,$4) RETURNING *",
      [fullName, email.toLowerCase(), phone || null, hash],
    );
    const user = safeUser(r.rows[0]);
    res
      .cookie("routeng_token", sign(r.rows[0]), cookieOptions)
      .status(201)
      .json({ user });
  } catch (e) {
    if (e.code === "23505")
      return res
        .status(409)
        .json({ error: "Email or phone is already registered" });
    handle(e, res);
  }
});
app.post("/api/auth/login", validate(loginSchema), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM users WHERE LOWER(email)=LOWER($1)",
      [req.body.email],
    );
    if (
      !r.rowCount ||
      !(await bcrypt.compare(req.body.password, r.rows[0].password_hash))
    )
      return res.status(401).json({ error: "Invalid email or password" });
    res
      .cookie("routeng_token", sign(r.rows[0]), cookieOptions)
      .json({ user: safeUser(r.rows[0]) });
  } catch (e) {
    handle(e, res);
  }
});
app.post("/api/auth/logout", (req, res) =>
  res
    .clearCookie("routeng_token", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
    })
    .json({ ok: true }),
);
app.get("/api/auth/me", auth(false), (req, res) =>
  res.json({ user: req.user || null }),
);

app.get("/api/rides", async (req, res) => {
  try {
    const q = z
      .object({
        origin: z.string().optional(),
        destination: z.string().optional(),
        date: z.iso.date().optional(),
        passengers: z.coerce.number().int().min(1).max(12).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const params = [];
    const where = [`r.status='OPEN'`, `r.departure_at >= NOW()`];
    if (q.origin) {
      params.push(q.origin);
      where.push(`LOWER(r.origin)=LOWER($${params.length})`);
    }
    if (q.destination) {
      params.push(q.destination);
      where.push(`LOWER(r.destination)=LOWER($${params.length})`);
    }
    if (q.date) {
      params.push(q.date);
      where.push(
        `DATE(r.departure_at AT TIME ZONE 'Africa/Lagos')=$${params.length}::date`,
      );
    }
    params.push(q.passengers);
    where.push(`r.seats_available >= $${params.length}`);
    params.push(q.limit);
    const sql = `SELECT r.*, u.full_name driver_name,u.rating driver_rating,u.total_ratings,u.verification_status, v.make_model,v.color,v.seats vehicle_seats FROM rides r JOIN users u ON u.id=r.driver_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE ${where.join(" AND ")} ORDER BY r.departure_at ASC LIMIT $${params.length}`;
    const rows = await pool.query(sql, params);
    res.json({ rides: rows.rows.map(formatRide) });
  } catch (e) {
    if (e.name === "ZodError")
      return res.status(400).json({ error: "Invalid search parameters" });
    handle(e, res);
  }
});
require("./journeys")(app, { pool, auth, formatRide, formatBooking });

app.get("/api/rides/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.*,u.full_name driver_name,u.email driver_email,u.phone driver_phone,u.rating driver_rating,u.total_ratings,u.verification_status,v.make_model,v.color,v.seats vehicle_seats FROM rides r JOIN users u ON u.id=r.driver_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=$1`,
      [req.params.id],
    );
    if (!r.rowCount) return res.status(404).json({ error: "Ride not found" });
    res.json({ ride: formatRide(r.rows[0]) });
  } catch (e) {
    handle(e, res);
  }
});
app.post("/api/rides", auth(), validate(rideSchema), async (req, res) => {
  try {
    const {
      origin,
      destination,
      pickupPoint,
      departureAt,
      seatsTotal,
      priceNaira,
      vehicleId,
      notes,
    } = req.body;
    if (origin.toLowerCase() === destination.toLowerCase())
      return res
        .status(400)
        .json({ error: "Origin and destination must be different" });
    if (new Date(departureAt) <= new Date())
      return res.status(400).json({ error: "Choose a future departure time" });
    if (!cities.includes(origin) || !cities.includes(destination))
      return res
        .status(400)
        .json({ error: "Choose a supported Nigerian city" });
    if (vehicleId) {
      const v = await pool.query(
        "SELECT seats FROM vehicles WHERE id=$1 AND owner_id=$2",
        [vehicleId, req.user.id],
      );
      if (!v.rowCount)
        return res
          .status(403)
          .json({ error: "Vehicle does not belong to you" });
      if (seatsTotal > v.rows[0].seats)
        return res
          .status(400)
          .json({ error: "Offered seats exceed vehicle capacity" });
    }
    const r = await pool.query(
      `INSERT INTO rides(driver_id,vehicle_id,origin,destination,pickup_point,departure_at,seats_total,seats_available,price_kobo,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) RETURNING *`,
      [
        req.user.id,
        vehicleId || null,
        origin,
        destination,
        pickupPoint,
        departureAt,
        seatsTotal,
        Math.round(priceNaira * 100),
        notes || null,
      ],
    );
    res.status(201).json({ ride: formatRide(r.rows[0]) });
  } catch (e) {
    handle(e, res);
  }
});
app.patch("/api/rides/:id", auth(), async (req, res) => {
  try {
    const schema = z.object({
      pickupPoint: z.string().min(2).max(180).optional(),
      departureAt: z.string().datetime({ offset: true }).optional(),
      notes: z.string().max(1000).optional(),
    });
    if (req.body.status !== undefined)
      return res
        .status(400)
        .json({ error: "Use the cancel ride operation to close a journey" });
    const body = schema.parse(req.body);
    if (body.departureAt && new Date(body.departureAt) <= new Date())
      return res.status(400).json({ error: "Choose a future departure time" });
    const r = await pool.query(
      `UPDATE rides SET pickup_point=COALESCE($1,pickup_point),departure_at=COALESCE($2,departure_at),notes=COALESCE($3,notes),status=COALESCE($4,status),updated_at=NOW() WHERE id=$5 AND driver_id=$6 RETURNING *`,
      [
        body.pickupPoint || null,
        body.departureAt || null,
        body.notes || null,
        body.status || null,
        req.params.id,
        req.user.id,
      ],
    );
    if (!r.rowCount)
      return res
        .status(404)
        .json({ error: "Ride not found or not owned by you" });
    res.json({ ride: formatRide(r.rows[0]) });
  } catch (e) {
    if (e.name === "ZodError")
      return res.status(400).json({ error: "Invalid ride update" });
    handle(e, res);
  }
});

app.post("/api/vehicles", auth(), validate(vehicleSchema), async (req, res) => {
  try {
    const b = req.body;
    const r = await pool.query(
      "INSERT INTO vehicles(owner_id,make_model,plate_number,color,year,seats) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        req.user.id,
        b.makeModel,
        b.plateNumber || null,
        b.color || null,
        b.year || null,
        b.seats,
      ],
    );
    res.status(201).json({ vehicle: formatVehicle(r.rows[0]) });
  } catch (e) {
    handle(e, res);
  }
});
app.get("/api/vehicles/me", auth(), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM vehicles WHERE owner_id=$1 ORDER BY created_at DESC",
      [req.user.id],
    );
    res.json({ vehicles: r.rows.map(formatVehicle) });
  } catch (e) {
    handle(e, res);
  }
});

app.get("/api/bookings/me", auth(), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.*,r.origin,r.destination,r.pickup_point,r.departure_at,r.driver_id,r.status ride_status,u.full_name driver_name FROM bookings b JOIN rides r ON r.id=b.ride_id JOIN users u ON u.id=r.driver_id WHERE b.passenger_id=$1 ORDER BY b.created_at DESC`,
      [req.user.id],
    );
    res.json({ bookings: r.rows.map(formatBooking) });
  } catch (e) {
    handle(e, res);
  }
});
app.get("/api/bookings/driver", auth(), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.*,r.origin,r.destination,r.pickup_point,r.departure_at,r.driver_id,r.status ride_status,u.full_name passenger_name,u.phone passenger_phone FROM bookings b JOIN rides r ON r.id=b.ride_id JOIN users u ON u.id=b.passenger_id WHERE r.driver_id=$1 ORDER BY b.created_at DESC`,
      [req.user.id],
    );
    res.json({ bookings: r.rows.map(formatBooking) });
  } catch (e) {
    handle(e, res);
  }
});

app.get("/api/notifications", auth(), async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [req.user.id],
    );
    res.json({ notifications: r.rows });
  } catch (e) {
    handle(e, res);
  }
});
app.patch("/api/notifications/:id/read", auth(), async (req, res) => {
  try {
    await pool.query(
      "UPDATE notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    res.json({ ok: true });
  } catch (e) {
    handle(e, res);
  }
});

app.post("/api/payments/initialize", auth(), async (req, res) => {
  if (!process.env.PAYSTACK_SECRET_KEY)
    return res
      .status(503)
      .json({
        error:
          "Payments are not configured. Add PAYSTACK_SECRET_KEY on the server.",
      });
  try {
    const { bookingId } = z
      .object({ bookingId: z.string().uuid() })
      .parse(req.body);
    const b = await pool.query(
      `SELECT b.*,u.email FROM bookings b JOIN users u ON u.id=b.passenger_id WHERE b.id=$1 AND b.passenger_id=$2`,
      [bookingId, req.user.id],
    );
    if (!b.rowCount)
      return res.status(404).json({ error: "Booking not found" });
    if (b.rows[0].status !== "ACCEPTED")
      return res
        .status(409)
        .json({
          error: "Your driver must accept this booking before you can pay",
        });
    if (b.rows[0].payment_status === "PAID")
      return res
        .status(409)
        .json({ error: "This booking has already been paid" });
    if (b.rows[0].payment_status === "PENDING")
      return res
        .status(409)
        .json({
          error:
            "A payment is already pending. Verify its reference before starting another",
        });
    const crypto = require("crypto");
    const reference = `RN-${bookingId.slice(0, 8)}-${crypto.randomBytes(5).toString("hex")}`;
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: b.rows[0].email,
          amount: b.rows[0].amount_kobo,
          currency: "NGN",
          reference,
          callback_url:
            (process.env.FRONTEND_URL ||
              req.protocol + "://" + req.get("host")) + "/?payment=return",
          metadata: { bookingId },
        }),
      },
    );
    const data = await response.json();
    if (!response.ok || !data.status)
      return res
        .status(502)
        .json({ error: "Payment provider rejected the request" });
    await pool.query(
      "UPDATE bookings SET payment_reference=$1,payment_status='PENDING',updated_at=NOW() WHERE id=$2",
      [reference, bookingId],
    );
    res.json({ authorizationUrl: data.data.authorization_url, reference });
  } catch (e) {
    if (e.name === "ZodError")
      return res.status(400).json({ error: "Invalid booking ID" });
    handle(e, res);
  }
});
app.get("/api/payments/verify/:reference", auth(), async (req, res) => {
  if (!process.env.PAYSTACK_SECRET_KEY)
    return res.status(503).json({ error: "Payments are not configured" });
  try {
    const found = await pool.query(
      "SELECT * FROM bookings WHERE payment_reference=$1 AND passenger_id=$2",
      [req.params.reference, req.user.id],
    );
    if (!found.rowCount)
      return res.status(404).json({ error: "Payment not found" });
    const booking = found.rows[0];
    const response = await fetch(
      "https://api.paystack.co/transaction/verify/" +
        encodeURIComponent(req.params.reference),
      {
        headers: { Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY },
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await response.json();
    if (!response.ok || !data.status)
      return res.status(502).json({ error: "Payment provider error" });
    if (
      data.data.reference !== req.params.reference ||
      Number(data.data.amount) !== Number(booking.amount_kobo) ||
      data.data.currency !== "NGN"
    )
      return res
        .status(409)
        .json({ error: "Payment details do not match this booking" });
    const paid = data.data.status === "success";
    const terminalFailure = ["failed", "abandoned", "reversed"].includes(
      data.data.status,
    );
    if (paid || terminalFailure)
      await pool.query(
        "UPDATE bookings SET payment_status=$1,updated_at=NOW() WHERE id=$2 AND payment_status<>'PAID'",
        [paid ? "PAID" : "FAILED", booking.id],
      );
    res.json({
      paid: paid || booking.payment_status === "PAID",
      status: data.data.status,
      requiresRefund:
        paid && ["CANCELLED", "REJECTED"].includes(booking.status),
    });
  } catch (e) {
    handle(e, res);
  }
});

app.get("/api/admin/users", auth(), admin, async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT id,full_name,email,phone,role,verification_status,rating,total_ratings,created_at FROM users ORDER BY created_at DESC LIMIT 200",
    );
    res.json({ users: r.rows });
  } catch (e) {
    handle(e, res);
  }
});
app.patch(
  "/api/admin/users/:id/verification",
  auth(),
  admin,
  async (req, res) => {
    try {
      const status = z
        .object({ status: z.enum(["UNVERIFIED", "PENDING", "VERIFIED"]) })
        .parse(req.body).status;
      const r = await pool.query(
        "UPDATE users SET verification_status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,verification_status",
        [status, req.params.id],
      );
      if (!r.rowCount) return res.status(404).json({ error: "User not found" });
      await pool.query(
        "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5)",
        [
          req.user.id,
          "VERIFY_USER",
          "user",
          req.params.id,
          JSON.stringify({ status }),
        ],
      );
      res.json({ user: r.rows[0] });
    } catch (e) {
      if (e.name === "ZodError")
        return res.status(400).json({ error: "Invalid verification status" });
      handle(e, res);
    }
  },
);
app.get("/api/admin/stats", auth(), admin, async (_req, res) => {
  try {
    const [u, r, b] = await Promise.all([
      pool.query("SELECT COUNT(*) count FROM users"),
      pool.query("SELECT COUNT(*) count FROM rides"),
      pool.query("SELECT COUNT(*) count FROM bookings"),
    ]);
    res.json({
      users: Number(u.rows[0].count),
      rides: Number(r.rows[0].count),
      bookings: Number(b.rows[0].count),
    });
  } catch (e) {
    handle(e, res);
  }
});

function formatRide(r) {
  return {
    id: r.id,
    origin: r.origin,
    destination: r.destination,
    pickupPoint: r.pickup_point,
    departureAt: r.departure_at,
    seatsTotal: r.seats_total,
    seatsAvailable: r.seats_available,
    priceNaira: Number(r.price_kobo) / 100,
    priceKobo: r.price_kobo,
    status: r.status,
    notes: r.notes,
    driver: {
      id: r.driver_id,
      name: r.driver_name,
      rating: r.driver_rating ? Number(r.driver_rating) : 0,
      totalRatings: r.total_ratings || 0,
      verificationStatus: r.verification_status,
    },
    vehicle: r.make_model
      ? { makeModel: r.make_model, color: r.color, seats: r.vehicle_seats }
      : null,
  };
}
function formatVehicle(v) {
  return {
    id: v.id,
    makeModel: v.make_model,
    plateNumber: v.plate_number,
    color: v.color,
    year: v.year,
    seats: v.seats,
  };
}
function formatBooking(b) {
  return {
    id: b.id,
    rideId: b.ride_id,
    passengerId: b.passenger_id,
    seats: b.seats,
    amountNaira: Number(b.amount_kobo) / 100,
    amountKobo: b.amount_kobo,
    status: b.status,
    paymentStatus: b.payment_status,
    paymentReference: b.payment_reference,
    pickupPoint: b.pickup_point,
    origin: b.origin,
    destination: b.destination,
    departureAt: b.departure_at,
    driverId: b.driver_id,
    driverName: b.driver_name,
    rideStatus: b.ride_status,
    passengerName: b.passenger_name,
    passengerPhone: b.passenger_phone,
  };
}

app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/{*splat}", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "API endpoint not found" });
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
if (require.main === module)
  app.listen(
    PORT,
    process.env.HOST ||
      (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
    () => console.log(`RouteNG running on http://localhost:${PORT}`),
  );
module.exports = { app, pool };
