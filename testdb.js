const { Client } = require('pg');
// التشفير بيتحدد من ?sslmode=require في DATABASE_URL (شوف src/db.js)
const client = new Client({
  connectionString: process.env.DATABASE_URL
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
