const Server = require("../services/Server");
const client = require("../redis/redis-client");
const sobj = new Server();

exports.addUserConnection = (socketId, phoneNumber) => {
    client.hSet("Session", phoneNumber, socketId);
};

exports.deleteUserConnection = async (socketId) => {
    client
        .hGetAll("Session")
        .then((sessionData) => {
            for (const phoneNumber in sessionData) {
                if (socketId === sessionData[phoneNumber]) {
                    client.hDel("Session", phoneNumber);
                }
            }
        })
        .catch((error) => {
            console.error(error.message);
        });
};

const getUser = (phoneNumber) => {
    return client.hGet('Session', phoneNumber)
};

exports.sendMessage = async (socket, data) => {
    if (data.to.startsWith("room-")) {
        socket.to(data.to).emit("receive-message", data);
    } else {
        sobj.appendChat(data)
        const receiver = await getUser(data.to);
        socket.to(receiver).emit("receive-message", data);
    }
};

exports.publishMessage = async (data) => {
    client.publish("MESSAGES", JSON.stringify(data));
};

exports.fetchChatMessage = async (detail) => {
    const key = `${detail.to}:${detail.from}`
    try {
        let result = await client.EXISTS(key)

        if (result) {
            result = await client.get(key)  
            result = JSON.parse(result)
        } else {
            result = await sobj.fetchChatMessage(detail);
            client.setEx(key, 10 ,JSON.stringify(result))
        }

        return result;
    } catch (err) {
        console.log(err.message);
    }
};