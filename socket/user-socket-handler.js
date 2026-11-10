const Server = require("../services/Server");
const sobj = new Server();
const userConnections = new Map();
const presenceUpdates = new Map();

exports.addUserConnection = (socketId, phoneNumber) => {
    const key = String(phoneNumber);
    const connections = userConnections.get(key) || new Set();
    connections.add(socketId);
    userConnections.set(key, connections);
    return connections.size === 1;
};

exports.deleteUserConnection = (socketId) => {
    for (const [phoneNumber, connections] of userConnections) {
        if (!connections.delete(socketId)) continue;
        if (connections.size === 0) {
            userConnections.delete(phoneNumber);
            return phoneNumber;
        }
        return null;
    }
    return null;
};

exports.updatePresence = async (io, user, status) => {
    const key = String(user.id);
    const previousUpdate = presenceUpdates.get(key) || Promise.resolve();
    const update = previousUpdate
        .catch(() => {})
        .then(async () => {
            await sobj.updateUserStatus(user.id, status);
            io.emit("presence-update", { contactNo: user.contactNo, status });
        });
    presenceUpdates.set(key, update);

    try {
        await update;
    } finally {
        if (presenceUpdates.get(key) === update) {
            presenceUpdates.delete(key);
        }
    }
};

exports.sendMessage = async (io, socket, data, user) => {
    if (!user.isActive || !(await sobj.isUserActive(user.id))) {
        throw new Error("Your account is disabled.");
    }
    if (!data || typeof data.message !== "string" || !data.message.trim()) {
        throw new Error("A message is required.");
    }

    const type = ["image", "audio"].includes(data.type) ? data.type : "text";
    const message = data.message;
    if (type === "audio") {
        if (user.role !== "admin" && !(await sobj.isFeatureEnabled(user, "voice_notes"))) {
            throw new Error("Voice notes are currently disabled.");
        }
        if (
            message.length > 28 * 1024 * 1024 ||
            !/^data:audio\/(?:webm|ogg|mp4|mpeg|wav)(?:;codecs=[a-z0-9._-]+)?;base64,[a-z0-9+/]+=*$/i.test(message)
        ) {
            throw new Error("Voice notes must be a supported audio recording under 50 minutes.");
        }
    }

    if (data.groupId !== undefined) {
        if (user.role !== "admin" && !(await sobj.isFeatureEnabled(user, "groups"))) {
            throw new Error("Private group chats are currently disabled.");
        }
        const groupId = String(data.groupId);
        if (!/^[1-9]\d*$/.test(groupId)) {
            throw new Error("Invalid group.");
        }
        if (!(await sobj.isGroupMember(groupId, user.id))) {
            throw new Error("You are not a member of this group.");
        }

        const saved = await sobj.appendGroupMessage(groupId, user.id, {
            type,
            message,
            datetime: new Date(),
        });
        const savedMessage = {
            id: saved.id,
            groupId,
            from: user.contactNo,
            fromName: user.name,
            img: user.img,
            type,
            message,
            datetime: saved.datetime,
        };
        const members = await sobj.fetchGroupMembers(groupId);
        for (const member of members) {
            io.to(`user-${member.id}`).emit("receive-message", savedMessage);
        }
        return savedMessage;
    }

    if (user.role !== "admin" && !(await sobj.isFeatureEnabled(user, "messaging"))) {
        throw new Error("Direct messaging is currently disabled.");
    }

    const to = typeof data.to === "string" ? data.to.trim() : "";
    if (!to || to.length > 64 || to.startsWith("room-")) {
        throw new Error("Choose a valid contact.");
    }
    const recipient = await sobj.getUserByContactNo(to);
    if (!recipient || !recipient.isActive) {
        throw new Error("That contact is not available.");
    }

    const messageData = {
        from: user.contactNo,
        to,
        img: user.img,
        type,
        message,
        datetime: new Date(),
    };
    const saved = await sobj.appendChat(messageData);
    const recipientRoom = io.sockets.adapter.rooms.get(`user-${recipient.id}`);
    const isDelivered = Boolean(recipientRoom && recipientRoom.size > 0);
    if (isDelivered) {
        await sobj.markMessagesDelivered(user.contactNo, to);
    }

    const status = isDelivered ? "delivered" : "sent";
    const savedMessage = { ...messageData, id: saved.id, datetime: saved.datetime, status };
    io.to(`user-${recipient.id}`).emit("receive-message", savedMessage);
    if (isDelivered) {
        io.to(`user-${user.id}`).emit("message-status", {
            ids: [saved.id],
            status,
        });
    }

    return savedMessage;
};

exports.fetchChatMessage = async (io, socket, detail, user) => {
    if (!user.isActive || !(await sobj.isUserActive(user.id))) {
        throw new Error("Your account is disabled.");
    }
    if (detail && detail.groupId !== undefined) {
        if (user.role !== "admin" && !(await sobj.isFeatureEnabled(user, "groups"))) {
            throw new Error("Private group chats are currently disabled.");
        }
        const groupId = String(detail.groupId);
        if (!/^[1-9]\d*$/.test(groupId)) {
            throw new Error("Invalid group.");
        }

        if (!(await sobj.isGroupMember(groupId, user.id))) {
            throw new Error("You are not a member of this group.");
        }
        await socket.join(`group-${groupId}`);
        return sobj.fetchGroupMessages(groupId, user.id);
    }

    if (user.role !== "admin" && !(await sobj.isFeatureEnabled(user, "messaging"))) {
        throw new Error("Direct messaging is currently disabled.");
    }
    const to = detail && typeof detail.to === "string" ? detail.to.trim() : "";
    if (!to || to.length > 64 || to === user.contactNo) {
        throw new Error("Choose a valid contact.");
    }

    const deliveredIds = await sobj.markMessagesDelivered(to, user.contactNo);
    if (deliveredIds.length > 0) {
        const sender = await sobj.getUserByContactNo(to);
        if (sender) {
            io.to(`user-${sender.id}`).emit("message-status", {
                ids: deliveredIds.map(({ id }) => id),
                status: "delivered",
            });
        }
    }

    return sobj.fetchChatMessage(user.contactNo, to);
};

exports.markMessagesRead = async (io, data, user) => {
    if (!user.isActive || !(await sobj.isUserActive(user.id))) {
        throw new Error("Your account is disabled.");
    }

    const fromContactNo = data && typeof data.to === "string" ? data.to.trim() : "";
    if (!fromContactNo || fromContactNo.length > 64 || fromContactNo === user.contactNo) {
        throw new Error("Choose a valid contact.");
    }

    const readIds = await sobj.markMessagesRead(fromContactNo, user.contactNo);
    if (readIds.length > 0) {
        const sender = await sobj.getUserByContactNo(fromContactNo);
        if (sender) {
            io.to(`user-${sender.id}`).emit("message-status", {
                ids: readIds.map(({ id }) => id),
                status: "read",
            });
        }
    }

    return readIds.map(({ id }) => id);
};