var express = require("express");
var router = express.Router();
const requireAuth = require("../auth/loginAuthentication");
const passport = require("passport");
const flash = require("connect-flash");
const Server = require('../services/Server')
const sobj = new Server()
const { register } = require('../controller/register')

router.use(flash());

router.use(requireAuth);

router.get("/", (req, res, next) => {
    if (req.user) {
        res.redirect("/index");
    } else {
        res.redirect("/login");
    }
});

router.get("/login", (req, res, next) => {
    let data = req.flash();
    if (data.error) result = [data.error, true];
    else result = data.messages;

    res.render("login", { messages: result });
});

router.get("/register", async (req, res, next) => {
    let data = req.flash();
    if (data.error) result = [data.error, true];
    else result = data.messages;

    res.render("registration", { messages: result });
});

router.post("/register", async (req, res, next) => {
    const data = req.body;
    
    const result = await register(data);
    if (result.hasError) {
        res.render("registration", {"message":result.error});
    } else {
		req.flash("messages", [result.message, false]);
		res.redirect("/login");
	}
});

router.get("/index", async (req, res, next) => {
    const user = req.user;
    const usersData = await sobj.fetchAllUser()
    res.render("index", { user: user, contacts: usersData });
});

router.post(
    "/login",
    passport.authenticate("local", {
        failureRedirect: "/",
        failureFlash: true,
    }),
    (req, res, next) => {
        req.session.user = req.user;
        res.redirect("/");
    }
);

router.get("/logout", (req, res, next) => {
    const mongoStore = req.sessionStore;

    if (req.session) {
        mongoStore.destroy(req.sessionID, (err) => {
            if (err) {
                return next(err)
            }

            req.session = null;
            res.redirect("/users/login");
        });
        
    } else {
        res.redirect("/users/login");
    }
});

module.exports = router;
