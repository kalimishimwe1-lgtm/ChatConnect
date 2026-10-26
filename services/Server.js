const { pool } = require("../db/database");
const bcrypt = require("bcrypt");

const userFields = `
    id,
    name,
    contact_no AS "contactNo",
    img,
    about,
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
            SELECT id, name, contact_no AS "contactNo", img, about, status, preview
            FROM users
            ORDER BY id
        `);
        return result.rows;
    };

    updateUserProfile = async (userId, name, about) => {
        await pool.query(
            `UPDATE users SET name = $2, about = $3 WHERE id = $1`,
            [userId, name, about]
        );
    };

    updateUserStatus = async (userId, status) => {
        await pool.query(
            `UPDATE users SET status = $2 WHERE id = $1`,
            [userId, status]
        );
    };

    fetchUsersByIds = async (ids) => {
        const result = await pool.query(
            `SELECT id::text AS id FROM users WHERE id = ANY($1::bigint[])`,
            [ids]
        );
        return result.rows.map((row) => row.id);
    };

    createGroup = async (name, creatorId, memberIds) => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const groupResult = await client.query(
                `INSERT INTO chat_groups (name, created_by)
                 VALUES ($1, $2)
                 RETURNING id, name`,
                [name, creatorId]
            );
            const group = groupResult.rows[0];
            await client.query(
                `INSERT INTO chat_group_members (group_id, user_id)
                 SELECT $1, user_id
                 FROM unnest($2::bigint[]) AS members(user_id)
                 ON CONFLICT DO NOTHING`,
                [group.id, [...new Set([String(creatorId), ...memberIds])]]
            );
            await client.query("COMMIT");
            return group;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    };

    fetchGroupsForUser = async (userId) => {
        const result = await pool.query(
            `SELECT g.id::text AS id, g.name
             FROM chat_groups g
             JOIN chat_group_members m ON m.group_id = g.id
             WHERE m.user_id = $1
             ORDER BY g.name`,
            [userId]
        );
        return result.rows;
    };

    isGroupMember = async (groupId, userId) => {
        const result = await pool.query(
            `SELECT 1
             FROM chat_group_members
             WHERE group_id = $1 AND user_id = $2`,
            [groupId, userId]
        );
        return result.rowCount > 0;
    };

    fetchGroupMessages = async (groupId, userId) => {
        if (!(await this.isGroupMember(groupId, userId))) {
            throw new Error("You are not a member of this group.");
        }

        const result = await pool.query(
            `SELECT m.id::text AS id,
                    u.contact_no AS "from",
                    u.img,
                    m.type,
                    m.message,
                    m.datetime,
                    m.group_id::text AS "groupId"
             FROM chat_group_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.group_id = $1
             ORDER BY m.datetime, m.id`,
            [groupId]
        );
        return result.rows;
    };

    appendGroupMessage = async (groupId, senderId, data) => {
        const result = await pool.query(
            `INSERT INTO chat_group_messages (group_id, sender_id, type, message, datetime)
             VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP))
             RETURNING id::text AS id, datetime`,
            [
                groupId,
                senderId,
                data.type || "text",
                data.message,
                data.datetime || null,
            ]
        );
        return result.rows[0];
    };

    fetchChatMessage = async (from, to) => {
        const result = await pool.query(
            `SELECT id::text AS id,
                    from_contact_no AS "from",
                    to_contact_no AS "to",
                    img,
                    type,
                    message,
                    datetime
             FROM chat_messages
             WHERE (from_contact_no = $1 AND to_contact_no = $2)
                OR (from_contact_no = $2 AND to_contact_no = $1)
             ORDER BY datetime`,
            [from, to]
        );
        return result.rows;
    };

    searchChatsForUser = async (userId, contactNo, query) => {
        const result = await pool.query(
            `SELECT *
             FROM (
                 SELECT NULL::text AS id,
                        'direct'::text AS "chatType",
                        other.contact_no AS "conversationId",
                        other.contact_no AS "contactNo",
                        other.name AS "conversationName",
                        other.img,
                        NULL::text AS message,
                        NULL::timestamptz AS datetime
                 FROM users other
                 WHERE other.id <> $1
                   AND POSITION(LOWER($3) IN LOWER(other.name)) > 0

                 UNION ALL

                 SELECT m.id::text AS id,
                        'direct'::text AS "chatType",
                        other.contact_no AS "conversationId",
                        other.contact_no AS "contactNo",
                        other.name AS "conversationName",
                        other.img,
                        LEFT(m.message, 120) AS message,
                        m.datetime
                 FROM chat_messages m
                 JOIN users other
                   ON other.contact_no = CASE
                       WHEN m.from_contact_no = $2 THEN m.to_contact_no
                       ELSE m.from_contact_no
                   END
                 WHERE (m.from_contact_no = $2 OR m.to_contact_no = $2)
                   AND m.type = 'text'
                   AND POSITION(LOWER($3) IN LOWER(m.message)) > 0

                 UNION ALL

                 SELECT NULL::text AS id,
                        'group'::text AS "chatType",
                        g.id::text AS "conversationId",
                        NULL::text AS "contactNo",
                        g.name AS "conversationName",
                        NULL::text AS img,
                        NULL::text AS message,
                        NULL::timestamptz AS datetime
                 FROM chat_groups g
                 JOIN chat_group_members gm ON gm.group_id = g.id
                 WHERE gm.user_id = $1
                   AND POSITION(LOWER($3) IN LOWER(g.name)) > 0

                 UNION ALL

                 SELECT m.id::text AS id,
                        'group'::text AS "chatType",
                        g.id::text AS "conversationId",
                        NULL::text AS "contactNo",
                        g.name AS "conversationName",
                        NULL::text AS img,
                        LEFT(m.message, 120) AS message,
                        m.datetime
                 FROM chat_group_messages m
                 JOIN chat_groups g ON g.id = m.group_id
                 JOIN chat_group_members gm
                   ON gm.group_id = g.id AND gm.user_id = $1
                 WHERE m.type = 'text'
                   AND POSITION(LOWER($3) IN LOWER(m.message)) > 0
             ) AS matches
             ORDER BY datetime DESC NULLS LAST, "conversationName"
             LIMIT 50`,
            [userId, contactNo, query]
        );
        return result.rows;
    };

    appendChat = async (data) => {
        const result = await pool.query(
            `INSERT INTO chat_messages
                (from_contact_no, to_contact_no, img, type, message, datetime)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_TIMESTAMP))
             RETURNING id::text AS id, datetime`,
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
