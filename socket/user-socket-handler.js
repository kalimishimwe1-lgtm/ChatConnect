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

exports.sendMessage = async (io, data) => {
    if (data.to.startsWith("room-")) {
        io.to(data.to).emit("receive-message", data);
    } else {
        await sobj.appendChat(data);
        const receiverConnections = userConnections.get(String(data.to));
        if (receiverConnections) {
            for (const socketId of receiverConnections) {
                io.to(socketId).emit("receive-message", data);
            }
        }
    }
};

exports.fetchChatMessage = async (detail) => {
    return sobj.fetchChatMessage(detail);
};