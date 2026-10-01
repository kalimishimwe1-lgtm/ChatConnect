const server = require("../app");
const io = require("socket.io")(server);
const { addUserConnection, deleteUserConnection, sendMessage, publishMessage, fetchChatMessage, } = require("./user-socket-handler");
const subscriber = require('../redis/redis-subscriber')

onConnected = (socket) => {
    // Subscribe to a channel
    subscriber.subscribe("MESSAGES", (message) => sendMessage(socket, JSON.parse(message)));

    socket.on("addPhoneNumber", (phoneNumber) => addUserConnection(socket.id, phoneNumber));

    socket.on("disconnect", () => deleteUserConnection(socket.id));

    socket.on("send-message", (data) => publishMessage(data));

    socket.on("join-room", (roomName) => socket.join("room-" + roomName));

    socket.on("load-message", async (data, onDataLoaded) => {
        const result = await fetchChatMessage(data);
        if (result) onDataLoaded(result);
    });
};

io.on("connection", onConnected);
