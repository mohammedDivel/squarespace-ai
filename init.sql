CREATE TABLE IF NOT EXISTS customer_queries (
    id SERIAL PRIMARY KEY,
    customer_email TEXT,
    query TEXT,
    response TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
