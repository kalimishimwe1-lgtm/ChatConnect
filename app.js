require("dotenv").config();

const express = require("express");
const http = require("http");
const bodyparser = require("body-parser");
const path = require("path");
const indexRoutes = require("./routes/index");
const session = require("express-session");
const passport = require("passport");
const PgSession = require("connect-pg-simple")(session);
const { pool, initializeDatabase } = require("./db/database");

const app = express();
const server = http.createServer(app);
const SECRET = process.env.SECRET;

if (!SECRET) {
    throw new Error("SECRET is required to start the application.");
}

app.set("view engine", "ejs");
app.set("trust proxy", 1);
app.use(bodyparser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
});

const sessionMiddleware = session({
    secret: SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PgSession({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true,
    }),
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
    },
});
app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());
require("./auth/passport-config");
app.use("/", indexRoutes);

const port = Number(process.env.PORT || 3000);

const startServer = async () => {
    try {
        await initializeDatabase();
        await pool.query("SELECT 1");
        console.log("Connected to PostgreSQL.");

        require("./socket/socketHandler")(server, sessionMiddleware);
        server.listen(port, "0.0.0.0", () => {
            console.log(`Listening on the port ${port}...`);
        });
    } catch (error) {
        console.error("Failed to initialize PostgreSQL:", error);
        await pool.end();
        process.exitCode = 1;
    }
};

startServer();

module.exports = server;
