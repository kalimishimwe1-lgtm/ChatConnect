const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
});

const initializeDatabase = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            contact_no TEXT NOT NULL UNIQUE,
            img TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'offline',
            preview TEXT,
            password TEXT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id BIGSERIAL PRIMARY KEY,
            from_contact_no TEXT NOT NULL,
            to_contact_no TEXT NOT NULL,
            img TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'text',
            message TEXT NOT NULL,
            datetime TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
};

module.exports = { pool, initializeDatabase };
