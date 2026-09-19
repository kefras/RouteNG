const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Database schema ready.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
