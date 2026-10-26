const { pool } = require("../db/database");
const bcrypt = require("bcrypt");

const userFields = `
    id,
    name,
    contact_no AS "contactNo",
    img,
    status,
    preview,
    password AS "Password"
`;

class Server {
    getUserByContactNo = async (contactNo) => {
        const result = await pool.query(
            `SELECT ${userFields} FROM users WHERE contact_no = $1`,
            [contactNo]
        );
        return result.rows[0] || null;
    };

    createAccount = async (data) => {
        const hashedPassword = await bcrypt.hash(data.Password, 10);
        await pool.query(
            `INSERT INTO users (name, contact_no, img, preview, password)
             VALUES ($1, $2, $3, $4, $5)`,
            [data.name, data.contactNo, data.img, "Hey", hashedPassword]
        );
    };

    getUserById = async (id) => {
        const result = await pool.query(
            `SELECT ${userFields} FROM users WHERE id::text = $1`,
            [String(id)]
        );
        return result.rows[0] || null;
    };

    fetchAllUser = async () => {
        const result = await pool.query(`
            SELECT id, name, contact_no AS "contactNo", img, status, preview
            FROM users
            ORDER BY id
        `);
        return result.rows;
    };

    fetchChatMessage = async (detail) => {
        const result = await pool.query(
            `SELECT from_contact_no AS "from",
                    to_contact_no AS "to",
                    img,
                    type,
                    message,
                    datetime
             FROM chat_messages
             WHERE (from_contact_no = $1 AND to_contact_no = $2)
                OR (from_contact_no = $2 AND to_contact_no = $1)
             ORDER BY datetime`,
            [detail.from, detail.to]
        );
        return result.rows;
    };

    appendChat = async (data) => {
        const result = await pool.query(
            `INSERT INTO chat_messages
                (from_contact_no, to_contact_no, img, type, message, datetime)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_TIMESTAMP))
             RETURNING id`,
            [
                data.from,
                data.to,
                data.img,
                data.type || "text",
                data.message,
                data.datetime || null,
            ]
        );
        return result.rows[0];
    };
}

module.exports = Server;
