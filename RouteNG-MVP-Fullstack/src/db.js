const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', err => console.error('Unexpected PostgreSQL error', err));

module.exports = { pool };
