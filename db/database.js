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
            about TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'offline',
            preview TEXT,
            password TEXT NOT NULL
        )
    `);

    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT ''
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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_groups (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_group_members (
            group_id BIGINT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (group_id, user_id)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_group_members_user_id_idx
        ON chat_group_members (user_id, group_id)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_group_messages (
            id BIGSERIAL PRIMARY KEY,
            group_id BIGINT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
            sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type TEXT NOT NULL DEFAULT 'text',
            message TEXT NOT NULL,
            datetime TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_group_messages_group_datetime_idx
        ON chat_group_messages (group_id, datetime)
    `);
};

module.exports = { pool, initializeDatabase };
