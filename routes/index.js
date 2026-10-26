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
    try {
        const user = req.user;
        const [usersData, groups] = await Promise.all([
            sobj.fetchAllUser(),
            sobj.fetchGroupsForUser(user.id),
        ]);
        res.render("index", {
            user,
            contacts: usersData,
            groups,
            groupSuccess: req.flash("groupSuccess")[0],
            groupError: req.flash("groupError")[0],
        });
    } catch (error) {
        next(error);
    }
});

router.post("/groups", async (req, res, next) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const submittedIds = req.body.memberIds === undefined
        ? []
        : Array.isArray(req.body.memberIds)
            ? req.body.memberIds
            : [req.body.memberIds];
    const creatorId = String(req.user.id);
    const memberIds = [...new Set(submittedIds.map(String))]
        .filter((id) => id !== creatorId);

    if (name.length < 1 || name.length > 60) {
        req.flash("groupError", "Group names must be between 1 and 60 characters.");
        return res.redirect("/index");
    }

    if (
        memberIds.length < 1 ||
        memberIds.length > 100 ||
        memberIds.some((id) => !/^[1-9]\d*$/.test(id))
    ) {
        req.flash("groupError", "Choose at least one valid member for your group.");
        return res.redirect("/index");
    }

    try {
        const existingIds = await sobj.fetchUsersByIds(memberIds);
        if (existingIds.length !== memberIds.length) {
            req.flash("groupError", "One or more selected members no longer exist.");
            return res.redirect("/index");
        }

        await sobj.createGroup(name, creatorId, memberIds);
        req.flash("groupSuccess", `Group "${name}" was created.`);
        res.redirect("/index");
    } catch (error) {
        next(error);
    }
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
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                return next(err);
            }

            res.clearCookie("connect.sid");
            res.redirect("/login");
        });
    } else {
        res.redirect("/login");
    }
});

module.exports = router;
