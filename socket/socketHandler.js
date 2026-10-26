const {
    addUserConnection,
    deleteUserConnection,
    sendMessage,
    fetchChatMessage,
} = require("./user-socket-handler");

module.exports = (server) => {
    const io = require("socket.io")(server);

    io.on("connection", (socket) => {
        socket.on("addPhoneNumber", (phoneNumber) => {
            addUserConnection(socket.id, phoneNumber);
        });

        socket.on("disconnect", () => {
            deleteUserConnection(socket.id);
        });

        socket.on("send-message", async (data) => {
            try {
                await sendMessage(io, data);
            } catch (error) {
                console.error("Failed to send chat message:", error);
                socket.emit("message-error", "The message could not be sent.");
            }
        });

        socket.on("join-room", (roomName) => {
            socket.join(`room-${roomName}`);
        });

        socket.on("load-message", async (data, onDataLoaded) => {
            try {
                const result = await fetchChatMessage(data);
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
