const express = require("express");
const app = express();
const bodyparser = require("body-parser");
const path = require("path");
const indexRoutes = require("./routes/index");
const session = require("express-session");
const passport = require("passport");
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo')
require('dotenv').config();

const SECRET = process.env.SECRET || 'hey';

const MONGODB_URL = process.env.ME_CONFIG_MONGODB_URL

mongoose.connect(MONGODB_URL)
  .then((result) => {
    console.log("Connected Successfully...")
  }) .catch((error) => {
    console.log("Failed to connect to the database: "+error.message)
});

app.set("view engine", "ejs");
app.use(bodyparser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const sessionMiddleware = session({
    secret: SECRET,
    resave: true,
    saveUninitialized: true,
    store: MongoStore.create({
      mongoUrl: MONGODB_URL
    })
});

app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());
require("./auth/passport-config");

app.use("/", indexRoutes);

const port = process.env.PORT || 3000;

const server = app.listen(port, () => console.log(`Listening on the port ${port}...`));

module.exports = server

require('./socket/socketHandler')