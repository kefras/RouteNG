const { z } = require('zod');

class JourneyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Every exit, including validation failures, releases the lock and ends the transaction.
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = function mountJourneys(app, { pool, auth, formatRide, formatBooking }) {
  const route = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof JourneyError) return res.status(error.status).json({ error: error.message });
      if (error.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: error.issues });
      if (error.code === '23505') return res.status(409).json({ error: 'You already have an active booking for this ride' });
      console.error(error);
      res.status(500).json({ error: 'We could not update this journey. Please try again.' });
    }
  };
  const fail = (status, message) => { throw new JourneyError(status, message); };

  app.get('/api/rides/me/published', auth(), route(async (req, res) => {
    const result = await pool.query(`SELECT r.*, u.full_name driver_name, u.rating driver_rating,
      u.total_ratings, u.verification_status, v.make_model, v.color, v.seats vehicle_seats
      FROM rides r JOIN users u ON u.id=r.driver_id LEFT JOIN vehicles v ON v.id=r.vehicle_id
      WHERE r.driver_id=$1 ORDER BY r.departure_at DESC LIMIT 100`, [req.user.id]);
    res.json({ rides: result.rows.map(formatRide) });
  }));

  app.post('/api/rides/:id/book', auth(), route(async (req, res) => {
    const body = z.object({ seats: z.coerce.number().int().min(1).max(12), pickupPoint: z.string().max(180).optional() }).parse(req.body);
    const booking = await transaction(pool, async client => {
      const result = await client.query('SELECT * FROM rides WHERE id=$1 FOR UPDATE', [req.params.id]);
      const ride = result.rows[0];
      if (!ride) fail(404, 'Ride not found');
      if (ride.driver_id === req.user.id) fail(400, 'You cannot book your own ride');
      if (ride.status !== 'OPEN') fail(409, 'This ride is no longer open');
      if (new Date(ride.departure_at) <= new Date()) fail(400, 'This ride has already departed');
      const existing = await client.query(`SELECT 1 FROM bookings WHERE ride_id=$1 AND passenger_id=$2 AND status IN ('PENDING','ACCEPTED')`, [ride.id, req.user.id]);
      if (existing.rowCount) fail(409, 'You already have an active booking for this ride');
      if (body.seats > ride.seats_available) fail(409, 'Not enough seats available. Please choose fewer seats.');
      const inserted = await client.query(`INSERT INTO bookings(ride_id,passenger_id,seats,amount_kobo,pickup_point)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [ride.id, req.user.id, body.seats, ride.price_kobo * body.seats, body.pickupPoint || ride.pickup_point]);
      await client.query(`UPDATE rides SET seats_available=seats_available-$1,
        status=CASE WHEN seats_available=$1 THEN 'FULL'::ride_status ELSE 'OPEN'::ride_status END,
        updated_at=NOW() WHERE id=$2`, [body.seats, ride.id]);
      await client.query('INSERT INTO notifications(user_id,title,message) VALUES($1,$2,$3)',
        [ride.driver_id, 'New seat request', `${req.user.fullName} requested ${body.seats} seat(s) on your ${ride.origin} → ${ride.destination} ride.`]);
      return inserted.rows[0];
    });
    res.status(201).json({ booking: formatBooking(booking) });
  }));

  app.patch('/api/bookings/:id/status', auth(), route(async (req, res) => {
    const { status } = z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED']) }).parse(req.body);
    const booking = await transaction(pool, async client => {
      // All booking mutations lock the ride before its bookings to avoid lock-order deadlocks.
      const lookup = await client.query('SELECT ride_id FROM bookings WHERE id=$1', [req.params.id]);
      if (!lookup.rowCount) fail(404, 'Booking not found');
      const ride = (await client.query('SELECT * FROM rides WHERE id=$1 FOR UPDATE', [lookup.rows[0].ride_id])).rows[0];
      const b = (await client.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      const driver = ride.driver_id === req.user.id, passenger = b.passenger_id === req.user.id;
      if (!driver && !passenger) fail(403, 'This booking does not belong to you');
      if (status === 'CANCELLED' && !passenger) fail(403, 'Only the passenger can cancel this booking');
      if (status !== 'CANCELLED' && !driver) fail(403, 'Only the driver can make this update');
      const allowed = { PENDING: ['ACCEPTED', 'REJECTED', 'CANCELLED'], ACCEPTED: ['CANCELLED', 'COMPLETED'] };
      if (!(allowed[b.status] || []).includes(status)) fail(409, 'This booking has already been updated. Refresh your trips.');
      if (['CANCELLED','COMPLETED'].includes(ride.status)) fail(409, 'This journey is no longer active');
      if (status === 'COMPLETED' && new Date(ride.departure_at) > new Date()) fail(400, 'A journey cannot be completed before departure');
      if (status !== 'COMPLETED' && new Date(ride.departure_at) <= new Date()) fail(400, 'This journey has already departed');
      const result = await client.query('UPDATE bookings SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [status, b.id]);
      if (['REJECTED','CANCELLED'].includes(status)) {
        await client.query(`UPDATE rides SET seats_available=seats_available+$1,
          status=CASE WHEN status='FULL' THEN 'OPEN'::ride_status ELSE status END,updated_at=NOW() WHERE id=$2`, [b.seats, b.ride_id]);
      }
      await client.query('INSERT INTO notifications(user_id,title,message) VALUES($1,$2,$3)',
        [driver ? b.passenger_id : ride.driver_id, 'Booking updated', `Your ${ride.origin} → ${ride.destination} booking is ${status.toLowerCase()}.${b.payment_status === 'PAID' && ['CANCELLED','REJECTED'].includes(status) ? ' A paid booking requires refund support.' : ''}`]);
      return result.rows[0];
    });
    res.json({ booking: formatBooking(booking) });
  }));

  async function cancelRide(req, res) {
    await transaction(pool, async client => {
      const ride = (await client.query('SELECT * FROM rides WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      if (!ride || ride.driver_id !== req.user.id) fail(404, 'Ride not found');
      if (!['OPEN','FULL'].includes(ride.status)) fail(409, 'This ride is already closed');
      if (new Date(ride.departure_at) <= new Date()) fail(400, 'This journey has already departed');
      const bookings = await client.query(`UPDATE bookings SET status='CANCELLED',updated_at=NOW()
        WHERE ride_id=$1 AND status IN ('PENDING','ACCEPTED') RETURNING *`, [ride.id]);
      await client.query(`UPDATE rides SET status='CANCELLED',seats_available=seats_total,updated_at=NOW() WHERE id=$1`, [ride.id]);
      for (const b of bookings.rows) await client.query('INSERT INTO notifications(user_id,title,message) VALUES($1,$2,$3)',
        [b.passenger_id, 'Ride cancelled', `Your driver cancelled ${ride.origin} → ${ride.destination}. Your booking is cancelled.${b.payment_status === 'PAID' ? ' Retain your payment reference and contact support for a refund.' : ''}`]);
    });
    res.json({ ok: true });
  }
  app.delete('/api/rides/:id', auth(), route(cancelRide));

  app.post('/api/rides/:id/reviews', auth(), route(async (req, res) => {
    const body = z.object({rating:z.coerce.number().int().min(1).max(5),comment:z.string().max(500).optional()}).parse(req.body);
    const review = await transaction(pool, async client => {
      const found = await client.query(`SELECT r.driver_id FROM rides r JOIN bookings b ON b.ride_id=r.id
        WHERE r.id=$1 AND b.passenger_id=$2 AND b.status='COMPLETED' LIMIT 1`,[req.params.id,req.user.id]);
      if (!found.rowCount) fail(400,'Only passengers with a completed booking can review this ride');
      const existing = await client.query('SELECT 1 FROM reviews WHERE ride_id=$1 AND reviewer_id=$2',[req.params.id,req.user.id]);
      if (existing.rowCount) fail(409,'You already reviewed this ride');
      const result = await client.query('INSERT INTO reviews(ride_id,reviewer_id,reviewee_id,rating,comment) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [req.params.id,req.user.id,found.rows[0].driver_id,body.rating,body.comment||null]);
      await client.query(`UPDATE users SET rating=((rating*total_ratings)+$1)/(total_ratings+1),
        total_ratings=total_ratings+1,updated_at=NOW() WHERE id=$2`,[body.rating,found.rows[0].driver_id]);
      return result.rows[0];
    });
    res.status(201).json({review});
  }));

  app.post('/api/payments/webhook', route(async (req, res) => {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({error:'Payments are not configured'});
    const crypto = require('node:crypto');
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto.createHmac('sha512',process.env.PAYSTACK_SECRET_KEY).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    if (typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex'))) {
      return res.status(401).json({error:'Invalid payment signature'});
    }
    if (req.body.event === 'charge.success') {
      const data = req.body.data;
      if (!data || typeof data.reference !== 'string' || data.currency !== 'NGN' || !Number.isSafeInteger(data.amount) || data.status !== 'success') return res.status(400).json({error:'Invalid payment event'});
      // Exact reference + currency + amount checks; retries cannot double-credit a booking.
      await pool.query(`UPDATE bookings SET payment_status='PAID',updated_at=NOW()
        WHERE payment_reference=$1 AND amount_kobo=$2 AND payment_status<>'PAID'`,[data.reference,data.amount]);
    }
    res.json({ok:true});
  }));
};

module.exports.transaction = transaction;
