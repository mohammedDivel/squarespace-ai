const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
(async () => {
  try {
    await client.connect();
    const r = await client.query('SELECT 1 as ok');
    console.log('connected:', r.rows);
  } catch (e) {
    console.error('connect error:', e.message);
  } finally {
    await client.end();
  }
})();
