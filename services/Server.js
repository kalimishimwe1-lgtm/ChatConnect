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
    role,
    is_active AS "isActive",
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

    isUserActive = async (userId) => {
        const result = await pool.query(
            `SELECT 1 FROM users WHERE id = $1 AND is_active = TRUE`,
            [userId]
        );
        return result.rowCount > 0;
    };

    fetchAllUser = async () => {
        const result = await pool.query(`
            SELECT id, name, contact_no AS "contactNo", img, about, status, preview
            FROM users
            WHERE is_active = TRUE
            ORDER BY id
        `);
        return result.rows;
    };

    fetchAdminUsers = async () => {
        const result = await pool.query(`
            SELECT id::text AS id, name, contact_no AS "contactNo",
                   role, is_active AS "isActive"
            FROM users
            ORDER BY id
        `);
        return result.rows;
    };

    updateUserAccess = async (adminId, targetId, role, isActive) => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(734829102)");

            const adminResult = await client.query(
                `SELECT role, is_active AS "isActive"
                 FROM users WHERE id = $1`,
                [adminId]
            );
            if (
                !adminResult.rows[0] ||
                adminResult.rows[0].role !== "admin" ||
                !adminResult.rows[0].isActive
            ) {
                await client.query("ROLLBACK");
                return { ok: false, status: 403, message: "Administrator access is required." };
            }
            if (String(adminId) === String(targetId)) {
                await client.query("ROLLBACK");
                return { ok: false, status: 400, message: "You cannot change your own role or access." };
            }

            const targetResult = await client.query(
                `SELECT role, is_active AS "isActive"
                 FROM users WHERE id = $1`,
                [targetId]
            );
            if (!targetResult.rows[0]) {
                await client.query("ROLLBACK");
                return { ok: false, status: 404, message: "That user account was not found." };
            }

            if (role !== "admin" || !isActive) {
                const remainingAdmins = await client.query(
                    `SELECT COUNT(*)::int AS count
                     FROM users
                     WHERE role = 'admin' AND is_active = TRUE
                       AND id <> $1`,
                    [targetId]
                );
                if (
                    targetResult.rows[0].role === "admin" &&
                    targetResult.rows[0].isActive &&
                    remainingAdmins.rows[0].count === 0
                ) {
                    await client.query("ROLLBACK");
                    return { ok: false, status: 400, message: "At least one active administrator must remain." };
                }
            }

            const updated = await client.query(
                `UPDATE users SET role = $2, is_active = $3
                 WHERE id = $1
                 RETURNING id::text AS id, name,
                           contact_no AS "contactNo", role,
                           is_active AS "isActive"`,
                [targetId, role, isActive]
            );
            await client.query("COMMIT");
            return { ok: true, user: updated.rows[0] };
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    };

    updateUserProfile = async (userId, name, about) => {
        await pool.query(
            `UPDATE users SET name = $2, about = $3 WHERE id = $1`,
            [userId, name, about]
        );
    };

    updateProfilePicture = async (userId, img) => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
                `UPDATE users SET img = $2 WHERE id = $1
                 RETURNING img, contact_no AS "contactNo"`,
                [userId, img]
            );
            if (result.rowCount === 0) {
                await client.query("ROLLBACK");
                return null;
            }

            await client.query(
                `UPDATE chat_messages SET img = $1 WHERE from_contact_no = $2`,
                [img, result.rows[0].contactNo]
            );
            await client.query("COMMIT");
            return result.rows[0];
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    };

    updateUserStatus = async (userId, status) => {
        await pool.query(
            `UPDATE users SET status = $2 WHERE id = $1`,
            [userId, status]
        );
    };

    fetchUsersByIds = async (ids) => {
        const result = await pool.query(
            `SELECT id::text AS id FROM users
             WHERE id = ANY($1::bigint[]) AND is_active = TRUE`,
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

    fetchGroupMembers = async (groupId) => {
        const result = await pool.query(
            `SELECT u.id::text AS id,
                    u.contact_no AS "contactNo",
                    u.name,
                    u.img
             FROM chat_group_members m
             JOIN users u ON u.id = m.user_id
             WHERE m.group_id = $1 AND u.is_active = TRUE`,
            [groupId]
        );
        return result.rows;
    };

    isGroupMember = async (groupId, userId) => {
        const result = await pool.query(
            `SELECT 1
             FROM chat_group_members m
             JOIN users u ON u.id = m.user_id
             WHERE m.group_id = $1 AND m.user_id = $2 AND u.is_active = TRUE`,
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
                    m.group_id::text AS "groupId",
                    (m.edited_at IS NOT NULL) AS edited,
                    (m.deleted_at IS NOT NULL) AS deleted,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'emoji', r.emoji, 'userId', r.user_id::text
                        ))
                        FROM chat_message_reactions r
                        WHERE r.chat_type = 'group' AND r.message_id = m.id
                    ), '[]'::json) AS reactions,
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM chat_message_receipts r
                            WHERE r.chat_type = 'group' AND r.message_id = m.id
                              AND r.read_at IS NOT NULL
                        ) THEN 'read'
                        WHEN EXISTS (
                            SELECT 1 FROM chat_message_receipts r
                            WHERE r.chat_type = 'group' AND r.message_id = m.id
                              AND r.delivered_at IS NOT NULL
                        ) THEN 'delivered'
                        ELSE 'sent'
                    END AS receipt
             FROM chat_group_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.group_id = $1
             ORDER BY m.datetime, m.id`,
            [groupId]
        );
        return result.rows;
    };

    appendGroupMessage = async (groupId, senderId, data) => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
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
            await client.query(
                `INSERT INTO chat_message_receipts (chat_type, message_id, user_id)
                 SELECT 'group', $1, user_id
                 FROM chat_group_members
                 WHERE group_id = $2 AND user_id <> $3
                 ON CONFLICT DO NOTHING`,
                [result.rows[0].id, groupId, senderId]
            );
            await client.query("COMMIT");
            return result.rows[0];
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    };

    fetchChatMessage = async (from, to) => {
        const result = await pool.query(
            `SELECT id::text AS id,
                    from_contact_no AS "from",
                    to_contact_no AS "to",
                    img,
                    type,
                    message,
                    datetime,
                    (m.edited_at IS NOT NULL) AS edited,
                    (m.deleted_at IS NOT NULL) AS deleted,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'emoji', r.emoji, 'userId', r.user_id::text
                        ))
                        FROM chat_message_reactions r
                        WHERE r.chat_type = 'direct' AND r.message_id = m.id
                    ), '[]'::json) AS reactions,
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM chat_message_receipts r
                            WHERE r.chat_type = 'direct' AND r.message_id = m.id
                              AND r.read_at IS NOT NULL
                        ) THEN 'read'
                        WHEN EXISTS (
                            SELECT 1 FROM chat_message_receipts r
                            WHERE r.chat_type = 'direct' AND r.message_id = m.id
                              AND r.delivered_at IS NOT NULL
                        ) THEN 'delivered'
                        ELSE 'sent'
                    END AS receipt
             FROM chat_messages m
             WHERE (m.from_contact_no = $1 AND m.to_contact_no = $2)
                OR (m.from_contact_no = $2 AND m.to_contact_no = $1)
             ORDER BY m.datetime, m.id`,
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
                   AND other.is_active = TRUE
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
                 WHERE other.is_active = TRUE
                   AND (m.from_contact_no = $2 OR m.to_contact_no = $2)
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
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(
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
            await client.query(
                `INSERT INTO chat_message_receipts (chat_type, message_id, user_id)
                 VALUES ('direct', $1, $2)
                 ON CONFLICT DO NOTHING`,
                [result.rows[0].id, data.recipientId]
            );
            await client.query("COMMIT");
            return result.rows[0];
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    };

    markConversationReceipts = async (chatType, conversationId, userId, read) => {
        const result = chatType === "group"
            ? await pool.query(
                `UPDATE chat_message_receipts r
                 SET delivered_at = COALESCE(r.delivered_at, CURRENT_TIMESTAMP),
                     read_at = CASE WHEN $3 THEN COALESCE(r.read_at, CURRENT_TIMESTAMP)
                                    ELSE r.read_at END
                 FROM chat_group_messages m
                 WHERE r.chat_type = 'group' AND r.message_id = m.id
                   AND r.user_id = $1 AND m.group_id = $2
                   AND (r.delivered_at IS NULL OR ($3 AND r.read_at IS NULL))
                 RETURNING m.id::text AS "messageId", m.sender_id::text AS "senderId"`,
                [userId, conversationId, read]
            )
            : await pool.query(
                `UPDATE chat_message_receipts r
                 SET delivered_at = COALESCE(r.delivered_at, CURRENT_TIMESTAMP),
                     read_at = CASE WHEN $3 THEN COALESCE(r.read_at, CURRENT_TIMESTAMP)
                                    ELSE r.read_at END
                 FROM chat_messages m
                 WHERE r.chat_type = 'direct' AND r.message_id = m.id
                   AND r.user_id = $1 AND m.to_contact_no = (
                       SELECT contact_no FROM users WHERE id = $1
                   ) AND m.from_contact_no = $2
                   AND (r.delivered_at IS NULL OR ($3 AND r.read_at IS NULL))
                 RETURNING m.id::text AS "messageId",
                           (SELECT id::text FROM users
                            WHERE contact_no = m.from_contact_no) AS "senderId"`,
                [userId, conversationId, read]
            );
        return result.rows;
    };

    updateMessage = async (chatType, messageId, userId, conversationId, message, deleted) => {
        const group = chatType === "group";
        const table = group ? "chat_group_messages" : "chat_messages";
        const senderCondition = group
            ? "sender_id = $2 AND group_id = $5"
            : "from_contact_no = (SELECT contact_no FROM users WHERE id = $2) AND to_contact_no = $5";
        const result = await pool.query(
            `UPDATE ${table}
             SET message = CASE WHEN $4 THEN 'This message was deleted' ELSE $3 END,
                 type = CASE WHEN $4 THEN 'text' ELSE type END,
                 edited_at = CASE WHEN $4 THEN edited_at ELSE CURRENT_TIMESTAMP END,
                 deleted_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE deleted_at END
             WHERE id = $1 AND ${senderCondition} AND deleted_at IS NULL
               AND ($4 OR type = 'text')
             RETURNING id::text AS id, message, type, datetime,
                       ${group ? "group_id::text" : "NULL::text"} AS "groupId",
                       ${group ? "sender_id::text" : "NULL::text"} AS "senderId",
                       ${group ? "NULL::text" : "to_contact_no"} AS "to"`,
            [messageId, userId, message, deleted, conversationId]
        );
        if (!result.rows[0]) {
            throw new Error("That message cannot be changed.");
        }
        return result.rows[0];
    };

    toggleMessageReaction = async (chatType, messageId, userId, conversationId, emoji) => {
        const group = chatType === "group";
        const exists = await pool.query(
            group
                ? `SELECT 1 FROM chat_group_messages m
                   JOIN chat_group_members gm ON gm.group_id = m.group_id
                   WHERE m.id = $1 AND gm.user_id = $2 AND m.group_id = $3`
                : `SELECT 1 FROM chat_messages m
                   JOIN users u ON u.id = $2
                   WHERE m.id = $1 AND u.contact_no IN
                       (m.from_contact_no, m.to_contact_no)
                     AND ($3 = m.from_contact_no OR $3 = m.to_contact_no)`,
            [messageId, userId, conversationId]
        );
        if (!exists.rowCount) throw new Error("That message is not available.");

        const removed = await pool.query(
            `DELETE FROM chat_message_reactions
             WHERE chat_type = $1 AND message_id = $2
               AND user_id = $3 AND emoji = $4`,
            [chatType, messageId, userId, emoji]
        );
        if (!removed.rowCount) {
            await pool.query(
                `INSERT INTO chat_message_reactions (chat_type, message_id, user_id, emoji)
                 VALUES ($1, $2, $3, $4)`,
                [chatType, messageId, userId, emoji]
            );
        }
        const [reactions, targets] = await Promise.all([
            pool.query(
                `SELECT emoji, user_id::text AS "userId"
                 FROM chat_message_reactions
                 WHERE chat_type = $1 AND message_id = $2`,
                [chatType, messageId]
            ),
            group
                ? pool.query(
                    `SELECT gm.user_id::text AS id FROM chat_group_members gm
                     JOIN chat_group_messages m ON m.group_id = gm.group_id
                     WHERE m.id = $1`,
                    [messageId]
                )
                : pool.query(
                    `SELECT id::text AS id FROM users WHERE contact_no IN (
                        SELECT from_contact_no FROM chat_messages WHERE id = $1
                        UNION
                        SELECT to_contact_no FROM chat_messages WHERE id = $1
                    )`,
                    [messageId]
                ),
        ]);
        return { reactions: reactions.rows, userIds: targets.rows.map((row) => row.id) };
    };

    fetchChatPreferences = async (userId) => {
        const result = await pool.query(
            `SELECT chat_type AS "chatType", conversation_id AS "conversationId",
                    is_pinned AS pinned, is_archived AS archived
             FROM user_chat_preferences WHERE user_id = $1`,
            [userId]
        );
        return result.rows;
    };

    updateChatPreference = async (userId, chatType, conversationId, preference, value) => {
        if (chatType === "group") {
            if (!(await this.isGroupMember(conversationId, userId))) {
                throw new Error("That group is not available.");
            }
        } else {
            const contact = await this.getUserByContactNo(conversationId);
            if (!contact || !contact.isActive || String(contact.id) === String(userId)) {
                throw new Error("That conversation is not available.");
            }
        }
        const column = preference === "pinned" ? "is_pinned" : "is_archived";
        await pool.query(
            `INSERT INTO user_chat_preferences
                (user_id, chat_type, conversation_id, ${column})
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, chat_type, conversation_id)
             DO UPDATE SET ${column} = EXCLUDED.${column},
                           updated_at = CURRENT_TIMESTAMP`,
            [userId, chatType, conversationId, value]
        );
        return { chatType, conversationId, preference, value };
    };

    createUserStatus = async (userId, content) => {
        const result = await pool.query(
            `INSERT INTO user_statuses (user_id, content, expires_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours')
             RETURNING id::text AS id, content, created_at AS "createdAt",
                       expires_at AS "expiresAt"`,
            [userId, content]
        );
        return result.rows[0];
    };

    fetchUserStatuses = async () => {
        await pool.query(`DELETE FROM user_statuses WHERE expires_at <= CURRENT_TIMESTAMP`);
        const result = await pool.query(
            `SELECT s.id::text AS id, s.content,
                    s.created_at AS "createdAt", s.expires_at AS "expiresAt",
                    u.id::text AS "userId", u.name,
                    u.contact_no AS "contactNo", u.img
             FROM user_statuses s
             JOIN users u ON u.id = s.user_id
             WHERE u.is_active = TRUE AND s.expires_at > CURRENT_TIMESTAMP
             ORDER BY s.created_at DESC LIMIT 200`
        );
        return result.rows;
    };
}

module.exports = Server;
