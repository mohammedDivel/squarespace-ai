const pool = require('./db');

async function addQuery(email, query, response) {
  const result = await pool.query(
    'INSERT INTO customer_queries (customer_email, query, response) VALUES ($1, $2, $3) RETURNING *',
    [email, query, response]
  );
  console.log('Added:', result.rows[0]);
}

async function getQueries() {
  const result = await pool.query('SELECT * FROM customer_queries ORDER BY created_at DESC');
  console.log('All queries:', result.rows);
}

(async () => {
  await addQuery(
    'client@example.com',
    'I cannot connect my domain to Squarespace',
    'Please check your DNS settings and ensure the A record points to Squarespace IP.'
  );
  await getQueries();
  pool.end();
})();
