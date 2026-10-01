const { createClient } = require("redis");

let subscriber;

if (!process.env.REDIS_PASSWORD) {
    subscriber = createClient();
} else {
    subscriber = createClient({
        password: process.env.REDIS_PASSWORD,
        socket: {
            host: process.env.REDIS_URL,
            port: process.env.REDIS_PORT,
        },
    });
}

subscriber.connect()
    .then(() => {
        console.log("Connected to Redis server : Subscriber");
    })
    .catch((error) => {
        console.error("Error connecting to Redis:", error);
    });

subscriber.on("error", function (error) {
    console.error("Subscriber Error:", error);
});

module.exports = subscriber