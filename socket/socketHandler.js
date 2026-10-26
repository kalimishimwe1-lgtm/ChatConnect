const {
    addUserConnection,
    deleteUserConnection,
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

        addUserConnection(socket.id, user.contactNo);

        socket.on("disconnect", () => {
            deleteUserConnection(socket.id);
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
