const bcrypt = require("bcryptjs");
const { pool } = require("./db");

// Explicit development data only. Never create predictable accounts in production.
const drivers = [
  [
    "Daniel Okoro",
    "daniel@routeng.ng",
    "Toyota Corolla",
    "Silver",
    "Lagos",
    "Ibadan",
    "Ikeja City Mall car park",
    3500,
  ],
  [
    "Aisha Musa",
    "aisha@routeng.ng",
    "Honda Accord",
    "Black",
    "Abuja",
    "Kaduna",
    "Jabi Lake Mall car park",
    5000,
  ],
  [
    "Emeka Nwosu",
    "emeka@routeng.ng",
    "Toyota Camry",
    "White",
    "Lagos",
    "Abuja",
    "Maryland Mall entrance",
    18000,
  ],
  [
    "Chidinma Eze",
    "chidinma@routeng.ng",
    "Hyundai Elantra",
    "Blue",
    "Enugu",
    "Onitsha",
    "Shoprite Polo Park car park",
    3000,
  ],
  [
    "Mary Adebayo",
    "mary@routeng.ng",
    "Toyota Sienna",
    "Grey",
    "Abuja",
    "Jos",
    "Utako Motor Park",
    7000,
  ],
  [
    "Ibrahim Sani",
    "ibrahim@routeng.ng",
    "Honda Civic",
    "Silver",
    "Kaduna",
    "Kano",
    "Kaduna Central Park",
    4500,
  ],
];
async function seed() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeding is disabled in production");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hash = await bcrypt.hash("Password123!", 12);
    for (let i = 0; i < drivers.length; i++) {
      const [name, email, model, color, origin, destination, pickup, price] =
        drivers[i];
      const inserted = await client.query(
        `INSERT INTO users(full_name,email,password_hash,verification_status)
        VALUES($1,$2,$3,'VERIFIED') ON CONFLICT(email) DO NOTHING RETURNING id`,
        [name, email, hash],
      );
      const driver =
        inserted.rows[0] ||
        (await client.query("SELECT id FROM users WHERE email=$1", [email]))
          .rows[0];
      const plate = "DEMO-" + String(i + 1).padStart(3, "0");
      let vehicle = (
        await client.query(
          "SELECT id FROM vehicles WHERE owner_id=$1 AND plate_number=$2",
          [driver.id, plate],
        )
      ).rows[0];
      if (!vehicle)
        vehicle = (
          await client.query(
            "INSERT INTO vehicles(owner_id,make_model,color,plate_number,seats) VALUES($1,$2,$3,$4,4) RETURNING id",
            [driver.id, model, color, plate],
          )
        ).rows[0];
      for (let day = 0; day < 7; day++) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + day);
        date.setUTCHours(7 + (i % 3) * 2, 30, 0, 0);
        if (date <= new Date()) continue;
        const existing = await client.query(
          "SELECT 1 FROM rides WHERE driver_id=$1 AND origin=$2 AND destination=$3 AND departure_at=$4",
          [driver.id, origin, destination, date],
        );
        if (!existing.rowCount)
          await client.query(
            `INSERT INTO rides(driver_id,vehicle_id,origin,destination,pickup_point,departure_at,seats_total,seats_available,price_kobo,notes)
          VALUES($1,$2,$3,$4,$5,$6,3,3,$7,$8)`,
            [
              driver.id,
              vehicle.id,
              origin,
              destination,
              pickup,
              date,
              price * 100,
              "Demo journey for testing. One small bag per passenger. Please arrive 10 minutes early.",
            ],
          );
      }
    }
    await client.query("COMMIT");
    console.log(
      "Development sample rides added for the next seven days. Demo driver: daniel@routeng.ng / Password123!",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
seed().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
