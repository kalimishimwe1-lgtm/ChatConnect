const Server = require("../services/Server");
const sobj = new Server();
const userConnections = new Map();

exports.addUserConnection = (socketId, phoneNumber) => {
    const key = String(phoneNumber);
    const connections = userConnections.get(key) || new Set();
    connections.add(socketId);
    userConnections.set(key, connections);
};

exports.deleteUserConnection = (socketId) => {
    for (const [phoneNumber, connections] of userConnections) {
        connections.delete(socketId);
        if (connections.size === 0) {
            userConnections.delete(phoneNumber);
        }
    }
};

exports.sendMessage = async (io, socket, data, user) => {
    if (!data || typeof data.message !== "string" || !data.message.trim()) {
        throw new Error("A message is required.");
    }

    const type = data.type === "image" ? "image" : "text";
    const message = data.message;
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