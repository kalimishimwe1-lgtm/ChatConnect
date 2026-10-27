const { randomUUID } = require("crypto");
const Server = require("../services/Server");

const sobj = new Server();
const calls = new Map();
const conversations = new Map();
const usersInCall = new Map();
const usersStartingCall = new Set();
const conversationsStartingCall = new Set();
const MAX_GROUP_CALL_PARTICIPANTS = 15;

const getUserSummary = (user) => ({
    id: String(user.id),
    contactNo: user.contactNo,
    name: user.name,
});

const emitResult = (acknowledge, result) => {
    if (typeof acknowledge === "function") {
        acknowledge(result);
    }
};

const cleanupCall = (io, call, reason) => {
    calls.delete(call.id);
    conversations.delete(call.conversationKey);
    io.to(`call-${call.id}`).emit("call:ended", { callId: call.id, reason });
    for (const [userId, socketId] of call.participants) {
        usersInCall.delete(userId);
        const participantSocket = io.sockets.sockets.get(socketId);
        if (participantSocket) {
            participantSocket.leave(`call-${call.id}`);
        }
    }
};

const removeParticipant = (io, call, userId, socketId) => {
    if (call.participants.get(userId) !== socketId) {
        return;
    }

    call.participants.delete(userId);
    usersInCall.delete(userId);
    const participantSocket = io.sockets.sockets.get(socketId);
    if (participantSocket) {
        participantSocket.leave(`call-${call.id}`);
    }

    if (call.chatType === "direct" || call.participants.size === 0) {
        cleanupCall(io, call, "participant-left");
        return;
    }

    io.to(`call-${call.id}`).emit("call:participant-left", { userId });
};

const attachCallHandlers = (io, socket, user, service = sobj) => {
    const userId = String(user.id);
    socket.join(`user-${userId}`);

    socket.on("call:start", async (data, acknowledge) => {
        let reservedUser = false;
        let reservedConversation = null;
        try {
            if (!data || !["audio", "video"].includes(data.mode)) {
                return emitResult(acknowledge, { ok: false, message: "Choose an audio or video call." });
            }
            if (usersInCall.has(userId) || usersStartingCall.has(userId)) {
                return emitResult(acknowledge, { ok: false, message: "You are already in a call." });
            }
            usersStartingCall.add(userId);
            reservedUser = true;

            let chatId;
            let conversationKey;
            let allowedUserIds;
            let recipients;

            if (data.chatType === "direct") {
                const contactNo = typeof data.contactNo === "string" ? data.contactNo.trim() : "";
                if (!contactNo || contactNo === user.contactNo || contactNo.length > 64) {
                    return emitResult(acknowledge, { ok: false, message: "Choose a valid contact to call." });
                }

                const recipient = await service.getUserByContactNo(contactNo);
                if (!recipient) {
                    return emitResult(acknowledge, { ok: false, message: "That contact is no longer available." });
                }
                chatId = contactNo;
                allowedUserIds = new Set([userId, String(recipient.id)]);
                recipients = [recipient];
                conversationKey = `direct:${[userId, String(recipient.id)].sort().join(":")}`;
            } else if (data.chatType === "group") {
                chatId = String(data.groupId || "");
                if (!/^[1-9]\d*$/.test(chatId) || !(await service.isGroupMember(chatId, user.id))) {
                    return emitResult(acknowledge, { ok: false, message: "You are not a member of this group." });
                }

                recipients = await service.fetchGroupMembers(chatId);
                allowedUserIds = new Set(recipients.map((member) => String(member.id)));
                conversationKey = `group:${chatId}`;
            } else {
                return emitResult(acknowledge, { ok: false, message: "Choose a valid chat to call." });
            }

            if (conversations.has(conversationKey) || conversationsStartingCall.has(conversationKey)) {
                return emitResult(acknowledge, { ok: false, message: "There is already a call in this chat." });
            }
            conversationsStartingCall.add(conversationKey);
            reservedConversation = conversationKey;

            const call = {
                id: randomUUID(),
                conversationKey,
                chatType: data.chatType,
                chatId,
                mode: data.mode,
                allowedUserIds,
                participants: new Map([[userId, socket.id]]),
                declined: new Set(),
            };
            calls.set(call.id, call);
            conversations.set(conversationKey, call.id);
            usersInCall.set(userId, call.id);
            await socket.join(`call-${call.id}`);

            const ring = {
                callId: call.id,
                chatType: call.chatType,
                chatId: call.chatId,
                mode: call.mode,
                caller: getUserSummary(user),
            };
            for (const recipient of recipients) {
                if (String(recipient.id) !== userId) {
                    io.to(`user-${recipient.id}`).emit("call:ring", ring);
                }
            }
            return emitResult(acknowledge, { ok: true, callId: call.id });
        } catch (error) {
            console.error("Failed to start call:", error);
            return emitResult(acknowledge, { ok: false, message: "The call could not be started." });
        } finally {
            if (reservedUser) usersStartingCall.delete(userId);
            if (reservedConversation) conversationsStartingCall.delete(reservedConversation);
        }
    });

    socket.on("call:join", async (data, acknowledge) => {
        try {
            const call = data && calls.get(String(data.callId));
            if (!call || !call.allowedUserIds.has(userId)) {
                return emitResult(acknowledge, { ok: false, message: "This call is no longer available." });
            }
            if (call.chatType === "group" && !(await service.isGroupMember(call.chatId, user.id))) {
                return emitResult(acknowledge, { ok: false, message: "You are not a member of this group." });
            }
            if (call.participants.has(userId)) {
                return emitResult(acknowledge, { ok: false, message: "You are already in this call." });
            }
            if (usersInCall.has(userId)) {
                return emitResult(acknowledge, { ok: false, message: "You are already in another call." });
            }
            const participantLimit = call.chatType === "direct" ? 2 : MAX_GROUP_CALL_PARTICIPANTS;
            if (call.participants.size >= participantLimit) {
                return emitResult(acknowledge, { ok: false, message: "This call has reached its participant limit." });
            }

            const existingParticipants = [...call.participants.keys()].map((participantId) => {
                const participantSocketId = call.participants.get(participantId);
                const participantSocket = io.sockets.sockets.get(participantSocketId);
                return participantSocket
                    ? getUserSummary(participantSocket.request.user)
                    : null;
            }).filter(Boolean);

            call.participants.set(userId, socket.id);
            usersInCall.set(userId, call.id);
            await socket.join(`call-${call.id}`);
            io.to(`call-${call.id}`).except(socket.id).emit("call:participant-joined", {
                callId: call.id,
                user: getUserSummary(user),
            });
            return emitResult(acknowledge, {
                ok: true,
                callId: call.id,
                mode: call.mode,
                participants: existingParticipants,
            });
        } catch (error) {
            console.error("Failed to join call:", error);
            return emitResult(acknowledge, { ok: false, message: "You could not join this call." });
        }
    });

    socket.on("call:signal", (data) => {
        const call = data && calls.get(String(data.callId));
        const targetId = data && String(data.toUserId || "");
        const targetSocketId = call && call.participants.get(targetId);
        const signal = data && data.signal;
        if (
            !call ||
            call.participants.get(userId) !== socket.id ||
            !targetSocketId ||
            !signal ||
            !["offer", "answer", "candidate"].includes(signal.type) ||
            JSON.stringify(signal).length > 100000
        ) {
            socket.emit("call:error", { message: "The call connection could not be established." });
            return;
        }

        io.to(targetSocketId).emit("call:signal", {
            callId: call.id,
            fromUserId: userId,
            user: getUserSummary(user),
            signal,
        });
    });

    socket.on("call:decline", (data) => {
        const call = data && calls.get(String(data.callId));
        if (!call || !call.allowedUserIds.has(userId) || call.participants.has(userId)) {
            return;
        }

        if (call.declined.has(userId)) return;
        call.declined.add(userId);
        const event = { callId: call.id, user: getUserSummary(user) };
        if (call.chatType === "direct") {
            const callerSocketId = call.participants.get([...call.participants.keys()][0]);
            io.to(callerSocketId).emit("call:declined", event);
            cleanupCall(io, call, "declined");
            return;
        }

        const callerUserId = [...call.participants.keys()][0];
        io.to(call.participants.get(callerUserId)).emit("call:declined", event);
    });

    socket.on("call:leave", (data) => {
        const call = data && calls.get(String(data.callId));
        if (call) {
            removeParticipant(io, call, userId, socket.id);
        }
    });

    socket.on("disconnect", () => {
        const callId = usersInCall.get(userId);
        const call = callId && calls.get(callId);
        if (call) {
            removeParticipant(io, call, userId, socket.id);
        }
    });
};

module.exports = attachCallHandlers;
