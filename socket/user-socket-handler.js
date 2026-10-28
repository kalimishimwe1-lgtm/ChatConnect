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
    if (
        (data.chatType === "group" && !/^[1-9]\d*$/.test(data.conversationId)) ||
        (data.chatType === "direct" &&
            (data.conversationId.length > 64 ||
                data.conversationId === user.contactNo ||
                data.conversationId.startsWith("room-")))
    ) {
        throw new Error("Invalid conversation.");
    }
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
        const members = await sobj.fetchGroupMembers(groupId);
        let isDelivered = false;
        for (const member of members) {
            if (String(member.id) === String(user.id)) continue;
            const connections = userConnections.get(String(member.contactNo));
            if (!connections) continue;
            isDelivered = true;
            const receipts = await sobj.markConversationReceipts(
                "group", groupId, member.id, false
            );
            receipts.forEach((receipt) => {
                io.to(`user-${receipt.senderId}`).emit("message:receipt", {
                    messageId: receipt.messageId,
                    status: "delivered",
                    chatType: "group",
                    conversationId: groupId,
                });
            });
        }
        savedMessage.receipt = isDelivered ? "delivered" : "sent";
        socket.to(`group-${groupId}`).emit("receive-message", savedMessage);
        return savedMessage;
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
        recipientId: recipient.id,
    };
    const saved = await sobj.appendChat(messageData);
    const receiverConnections = userConnections.get(to);
    const savedMessage = {
        ...messageData,
        id: saved.id,
        datetime: saved.datetime,
        receipt: receiverConnections ? "delivered" : "sent",
    };
    if (receiverConnections) {
        for (const socketId of receiverConnections) {
            io.to(socketId).emit("receive-message", savedMessage);
        }
        const receipts = await sobj.markConversationReceipts(
            "direct", user.contactNo, recipient.id, false
        );
        receipts.forEach((receipt) => {
            io.to(`user-${receipt.senderId}`).emit("message:receipt", {
                messageId: receipt.messageId,
                status: "delivered",
                chatType: "direct",
                conversationId: to,
            });
        });
    }
    return savedMessage;
};

exports.fetchChatMessage = async (io, socket, detail, user) => {
    if (!user.isActive || !(await sobj.isUserActive(user.id))) {
        throw new Error("Your account is disabled.");
    }
    if (detail && detail.groupId !== undefined) {
        const groupId = String(detail.groupId);
        if (!/^[1-9]\d*$/.test(groupId)) {
            throw new Error("Invalid group.");
        }

        if (!(await sobj.isGroupMember(groupId, user.id))) {
            throw new Error("You are not a member of this group.");
        }
        await socket.join(`group-${groupId}`);
        const [messages, receipts] = await Promise.all([
            sobj.fetchGroupMessages(groupId, user.id),
            sobj.markConversationReceipts("group", groupId, user.id, true),
        ]);
        receipts.forEach((receipt) => {
            io.to(`user-${receipt.senderId}`).emit("message:receipt", {
                messageId: receipt.messageId,
                status: "read",
                chatType: "group",
                conversationId: groupId,
            });
        });
        return messages;
    }

    const to = detail && typeof detail.to === "string" ? detail.to.trim() : "";
    if (!to || to.length > 64 || to === user.contactNo) {
        throw new Error("Choose a valid contact.");
    }
    const [messages, receipts] = await Promise.all([
        sobj.fetchChatMessage(user.contactNo, to),
        sobj.markConversationReceipts("direct", to, user.id, true),
    ]);
    receipts.forEach((receipt) => {
        io.to(`user-${receipt.senderId}`).emit("message:receipt", {
            messageId: receipt.messageId,
            status: "read",
            chatType: "direct",
            conversationId: user.contactNo,
        });
    });
    return messages;
};

exports.updateMessage = async (io, socket, data, user) => {
    if (!data || !["direct", "group"].includes(data.chatType) ||
        !/^[1-9]\d*$/.test(String(data.messageId)) ||
        typeof data.conversationId !== "string") {
        throw new Error("Invalid message.");
    }
    if (!user.isActive || !(await sobj.isUserActive(user.id))) {
        throw new Error("Your account is disabled.");
    }
    if (
        (data.chatType === "group" && !/^[1-9]\d*$/.test(data.conversationId)) ||
        (data.chatType === "direct" &&
            (data.conversationId.length > 64 ||
                data.conversationId === user.contactNo ||
                data.conversationId.startsWith("room-")))
    ) {
        throw new Error("Invalid conversation.");
    }
    if (!["edit", "delete"].includes(data.action)) {
        throw new Error("Choose edit or delete.");
    }
    const deleted = data.action === "delete";
    const text = typeof data.message === "string" ? data.message.trim() : "";
    if (!deleted && (!text || text.length > 4000)) {
        throw new Error("Edited messages must contain 1 to 4000 characters.");
    }
    if (data.chatType === "group" &&
        !(await sobj.isGroupMember(String(data.conversationId), user.id))) {
        throw new Error("You are not a member of this group.");
    }
    const updated = await sobj.updateMessage(
        data.chatType, String(data.messageId), user.id,
        data.conversationId, text, deleted
    );
    const payload = {
        ...updated,
        chatType: data.chatType,
        conversationId: data.conversationId,
        edited: !deleted,
        deleted,
    };
    if (data.chatType === "group") {
        io.to(`group-${updated.groupId}`).emit("message:updated", payload);
    } else {
        const recipient = await sobj.getUserByContactNo(updated.to);
        payload.from = user.contactNo;
        io.to(`user-${user.id}`).emit("message:updated", payload);
        if (recipient) io.to(`user-${recipient.id}`).emit("message:updated", payload);
    }
    return payload;
};

exports.toggleReaction = async (io, data, user) => {
    const allowedEmojis = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
    if (!data || !["direct", "group"].includes(data.chatType) ||
        !/^[1-9]\d*$/.test(String(data.messageId)) ||
        !allowedEmojis.includes(data.emoji) ||
        typeof data.conversationId !== "string") {
        throw new Error("Invalid reaction.");
    }
    if (!user.isActive || !(await sobj.isUserActive(user.id))) {
        throw new Error("Your account is disabled.");
    }
    if (
        (data.chatType === "group" && !/^[1-9]\d*$/.test(data.conversationId)) ||
        (data.chatType === "direct" &&
            (data.conversationId.length > 64 ||
                data.conversationId === user.contactNo ||
                data.conversationId.startsWith("room-")))
    ) {
        throw new Error("Invalid conversation.");
    }
    if (data.chatType === "group" &&
        !(await sobj.isGroupMember(String(data.conversationId), user.id))) {
        throw new Error("You are not a member of this group.");
    }
    const result = await sobj.toggleMessageReaction(
        data.chatType, String(data.messageId), user.id,
        data.conversationId, data.emoji
    );
    result.userIds.forEach((id) => {
        io.to(`user-${id}`).emit("message:reactions", {
            chatType: data.chatType,
            messageId: String(data.messageId),
            conversationId: data.chatType === "direct" &&
                String(id) !== String(user.id)
                ? user.contactNo
                : data.conversationId,
            reactions: result.reactions,
        });
    });
    return result.reactions;
};

exports.updateTyping = async (io, socket, data, user) => {
    if (!user.isActive || !(await sobj.isUserActive(user.id))) {
        throw new Error("Your account is disabled.");
    }
    if (data && data.groupId !== undefined) {
        const groupId = String(data.groupId);
        if (!/^[1-9]\d*$/.test(groupId) ||
            !(await sobj.isGroupMember(groupId, user.id))) {
            throw new Error("That group is not available.");
        }
        socket.to(`group-${groupId}`).emit("chat:typing", {
            chatType: "group",
            conversationId: groupId,
            name: user.name,
            isTyping: Boolean(data.isTyping),
        });
        return;
    }
    const to = data && typeof data.to === "string" ? data.to.trim() : "";
    const recipient = await sobj.getUserByContactNo(to);
    if (!recipient || !recipient.isActive || to === user.contactNo) {
        throw new Error("That conversation is not available.");
    }
    io.to(`user-${recipient.id}`).emit("chat:typing", {
        chatType: "direct",
        conversationId: user.contactNo,
        isTyping: Boolean(data.isTyping),
    });
};