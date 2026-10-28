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
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
    `);

    const adminContactNos = [...new Set(
        (process.env.ADMIN_CONTACT_NOS || "")
            .split(",")
            .map((contactNo) => contactNo.trim())
            .filter(Boolean)
    )];
    if (adminContactNos.length) {
        await pool.query(
            `UPDATE users SET role = 'admin', is_active = TRUE
             WHERE contact_no = ANY($1::text[])`,
            [adminContactNos]
        );
    }

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
        ALTER TABLE chat_messages
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
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
        ALTER TABLE chat_group_messages
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_group_messages_group_datetime_idx
        ON chat_group_messages (group_id, datetime)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_message_receipts (
            chat_type TEXT NOT NULL CHECK (chat_type IN ('direct', 'group')),
            message_id BIGINT NOT NULL,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            delivered_at TIMESTAMPTZ,
            read_at TIMESTAMPTZ,
            PRIMARY KEY (chat_type, message_id, user_id)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_message_receipts_user_unread_idx
        ON chat_message_receipts (user_id, chat_type, read_at)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_message_reactions (
            chat_type TEXT NOT NULL CHECK (chat_type IN ('direct', 'group')),
            message_id BIGINT NOT NULL,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emoji TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (chat_type, message_id, user_id, emoji)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_chat_preferences (
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            chat_type TEXT NOT NULL CHECK (chat_type IN ('direct', 'group')),
            conversation_id TEXT NOT NULL,
            is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
            is_archived BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, chat_type, conversation_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_statuses (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMPTZ NOT NULL
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS user_statuses_expiration_idx
        ON user_statuses (expires_at, user_id)
    `);
};

module.exports = { pool, initializeDatabase };
