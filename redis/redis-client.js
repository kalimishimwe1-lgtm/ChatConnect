const { createClient } = require("redis");

let client;

if (!process.env.REDIS_PASSWORD) {
    client = createClient();
} else {
    client = createClient({
        password: process.env.REDIS_PASSWORD,
        socket: {
            host: process.env.REDIS_URL,
            port: process.env.REDIS_PORT,
        },
    });
}

client.on("error", (err) => console.log(`Redis Client ${err}`));

client
    .connect()
    .then(() => {
        console.log("Connected to Redis server : Client");
    })
    .catch((error) => {
        console.error("Error connecting to Redis:", error);
    });

module.exports = client;
