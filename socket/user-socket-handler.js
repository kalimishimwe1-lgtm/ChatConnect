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
    if (!data || typeof data.message !== "string" || !data.message.trim()) {
        throw new Error("A message is required.");
    }

    const type = ["image", "audio"].includes(data.type) ? data.type : "text";
    const message = data.message;
    if (type === "audio" && (
        message.length > 28 * 1024 * 1024 ||
        !/^data:audio\/(?:webm|ogg|mp4|mpeg|wav)(?:;codecs=[a-z0-9._-]+)?;base64,[a-z0-9+/]+=*$/i.test(message)
    )) {
        throw new Error("Voice notes must be a supported audio recording under 50 minutes.");
    }

    if (data.groupId !== undefined) {
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
            img: user.img,
            type,
            message,
            datetime: saved.datetime,
        };
        socket.to(`group-${groupId}`).emit("receive-message", savedMessage);
        return savedMessage;
    }

    const to = typeof data.to === "string" ? data.to.trim() : "";
    if (!to || to.length > 64 || to.startsWith("room-")) {
        throw new Error("Choose a valid contact.");
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
    const savedMessage = { ...messageData, id: saved.id, datetime: saved.datetime };
    const receiverConnections = userConnections.get(to);
    if (receiverConnections) {
        for (const socketId of receiverConnections) {
            io.to(socketId).emit("receive-message", savedMessage);
        }
    }
    return savedMessage;
};

exports.fetchChatMessage = async (socket, detail, user) => {
    if (detail && detail.groupId !== undefined) {
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

    const to = detail && typeof detail.to === "string" ? detail.to.trim() : "";
    if (!to || to.length > 64 || to === user.contactNo) {
        throw new Error("Choose a valid contact.");
    }
    return sobj.fetchChatMessage(user.contactNo, to);
};