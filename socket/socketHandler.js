const {
    addUserConnection,
    deleteUserConnection,
    updatePresence,
    sendMessage,
    fetchChatMessage,
} = require("./user-socket-handler");
const passport = require("passport");

module.exports = (server, sessionMiddleware) => {
    const io = require("socket.io")(server);
    io.engine.use(sessionMiddleware);
    io.engine.use(passport.initialize());
    io.engine.use(passport.session());

    io.on("connection", (socket) => {
        const user = socket.request.user;
        if (!user) {
            socket.disconnect(true);
            return;
        }

        const isFirstConnection = addUserConnection(socket.id, user.contactNo);
        let initialPresenceReady = Promise.resolve();
        if (isFirstConnection) {
            const initialStatus = user.status === "away" ? "away" : "online";
            initialPresenceReady = updatePresence(io, user, initialStatus).catch((error) => {
                console.error("Failed to update user presence on connection:", error);
                socket.emit("presence-error", "Your presence could not be updated.");
            });
        }

        socket.on("disconnect", async () => {
            const disconnectedUser = deleteUserConnection(socket.id);
            if (disconnectedUser) {
                try {
                    await initialPresenceReady;
                    await updatePresence(io, user, "offline");
                } catch (error) {
                    console.error("Failed to update user presence on disconnect:", error);
                }
            }
        });

        socket.on("set-presence", async (status, acknowledge) => {
            if (status !== "online" && status !== "away") {
                if (typeof acknowledge === "function") {
                    acknowledge({ ok: false, message: "Choose online or away status." });
                }
                return;
            }

            try {
                await initialPresenceReady;
                await updatePresence(io, user, status);
                user.status = status;
                if (typeof acknowledge === "function") {
                    acknowledge({ ok: true, status });
                }
            } catch (error) {
                console.error("Failed to update user presence:", error);
                if (typeof acknowledge === "function") {
                    acknowledge({ ok: false, message: "Your presence could not be updated." });
                }
            }
        });

        socket.on("send-message", async (data, acknowledge) => {
            try {
                const message = await sendMessage(io, socket, data, user);
                if (typeof acknowledge === "function") {
                    acknowledge({ ok: true, message });
                }
            } catch (error) {
                console.error("Failed to send chat message:", error);
                if (typeof acknowledge === "function") {
                    acknowledge({ ok: false, message: "The message could not be sent." });
                } else {
                    socket.emit("message-error", "The message could not be sent.");
                }
            }
        });

        socket.on("load-message", async (data, onDataLoaded) => {
            try {
                const result = await fetchChatMessage(socket, data, user);
                if (typeof onDataLoaded === "function") {
                    onDataLoaded(result);
                }
            } catch (error) {
                console.error("Failed to load chat history:", error);
                socket.emit("message-error", "Chat history could not be loaded.");
            }
        });
    });

    return io;
};
