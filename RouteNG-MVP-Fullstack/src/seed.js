const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const routes = [
  ['Abuja','Kaduna','Jabi Lake Mall car park','2026-09-25T08:00:00+01:00',3,500000,'Toyota Corolla','ABJ-001-KD','Daniel Okoro'],
  ['Abuja','Jos','Utako Motor Park','2026-09-26T07:30:00+01:00',2,700000,'Honda Accord','ABJ-002-JS','Mary Adebayo'],
  ['Lagos','Abuja','Ojota Bus Terminal','2026-09-27T06:00:00+01:00',3,1800000,'Toyota Camry','LAG-003-FCT','Emeka Nwosu'],
  ['Makurdi','Enugu','Wurukum Park','2026-09-25T09:00:00+01:00',2,650000,'Hyundai Elantra','MDK-004-ENU','John Kalu'],
  ['Abuja','Keffi','Nyanya Junction','2026-09-25T10:00:00+01:00',4,250000,'Toyota Sienna','ABJ-005-NAS','Aisha Musa'],
  ['Kaduna','Kano','Kaduna Central Park','2026-09-28T08:30:00+01:00',3,450000,'Honda Civic','KAD-006-KN','Ibrahim Sani']
];
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash('Password123!', 12);
    const users = [];
    const admin = await client.query(`INSERT INTO users(full_name,email,phone,password_hash,role,verification_status) VALUES($1,$2,$3,$4,'ADMIN','VERIFIED') ON CONFLICT(email) DO UPDATE SET role='ADMIN' RETURNING id`, ['RouteNG Admin','admin@routeng.ng','08030000000',hash]);
    for (const [name,email,phone] of [['Daniel Okoro','daniel@routeng.ng','08030000001'],['Mary Adebayo','mary@routeng.ng','08030000002'],['Emeka Nwosu','emeka@routeng.ng','08030000003'],['John Kalu','john@routeng.ng','08030000004'],['Aisha Musa','aisha@routeng.ng','08030000005'],['Ibrahim Sani','ibrahim@routeng.ng','08030000006']]) {
      const r = await client.query(`INSERT INTO users(full_name,email,phone,password_hash,verification_status) VALUES($1,$2,$3,$4,'VERIFIED') ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name RETURNING id`, [name,email,phone,hash]);
      users.push(r.rows[0].id);
    }
    for (let i=0;i<routes.length;i++) {
      const [origin,destination,pickup,departure,seats,price,vehicle,plate] = routes[i];
      const driverId = users[i];
      const existing = await client.query('SELECT 1 FROM rides WHERE driver_id=$1 AND origin=$2 AND destination=$3 AND departure_at=$4',[driverId,origin,destination,departure]);
      if (!existing.rowCount) {
        const v = await client.query('INSERT INTO vehicles(owner_id,make_model,plate_number,seats) VALUES($1,$2,$3,$4) RETURNING id',[driverId,vehicle,plate,seats+1]);
        await client.query(`INSERT INTO rides(driver_id,vehicle_id,origin,destination,pickup_point,departure_at,seats_total,seats_available,price_kobo) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)`,[driverId,v.rows[0].id,origin,destination,pickup,seats,price]);
      }
    }
    await client.query('COMMIT');
    console.log('Seed complete. Demo password: Password123!');
    console.log('Admin: admin@routeng.ng / Password123!');
  } catch(e) { await client.query('ROLLBACK'); console.error(e); process.exitCode=1; }
  finally { client.release(); await pool.end(); }
})();
