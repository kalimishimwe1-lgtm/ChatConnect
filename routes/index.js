var express = require("express");
var router = express.Router();
const { createHmac, randomBytes, timingSafeEqual } = require("crypto");
const requireAuth = require("../auth/loginAuthentication");
const requireAdmin = require("../auth/requireAdmin");
const passport = require("passport");
const flash = require("connect-flash");
const Server = require('../services/Server')
const sobj = new Server()
const { register } = require('../controller/register')
const { profilePictureUpload } = require("../services/profilePictureUpload");

router.use(flash());

router.use(requireAuth);

const isValidAdminCsrfToken = (sessionToken, submittedToken) => {
    if (typeof sessionToken !== "string" || typeof submittedToken !== "string") {
        return false;
    }
    const expected = Buffer.from(sessionToken);
    const submitted = Buffer.from(submittedToken);
    return expected.length === submitted.length && timingSafeEqual(expected, submitted);
};

router.get("/ice-servers", (req, res) => {
    const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    const turnUrls = (process.env.TURN_URLS || "")
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean);
    const sharedSecret = process.env.TURN_SHARED_SECRET;

    if (turnUrls.length && sharedSecret) {
        const username = `${Math.floor(Date.now() / 1000) + 3600}:${req.user.id}`;
        const credential = createHmac("sha1", sharedSecret)
            .update(username)
            .digest("base64");
        iceServers.push({ urls: turnUrls, username, credential });
    }

    res.set("Cache-Control", "no-store");
    res.json({ iceServers });
});

const handleProfilePictureUploadError = (req, res, next) => {
    const error = req.profilePictureError;
    if (!error) {
        return next();
    }

    const message = error.code === "LIMIT_FILE_SIZE"
        ? "Profile pictures must be 2 MB or smaller."
        : error.message;
    const status = error.statusCode || (error.code === "LIMIT_FILE_SIZE" ? 413 : 400);

    if (req.path === "/register") {
        return res.status(status).render("registration", { message });
    }

    return res.status(status).json({ error: message });
};

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

router.post("/register", profilePictureUpload, handleProfilePictureUploadError, async (req, res, next) => {
    try {
        const data = {
            ...req.body,
            img: req.profilePicture || "/images/default-profile.svg",
        };
        const result = await register(data);

        if (result.hasError) {
            return res.status(400).render("registration", { message: result.error });
        }

        req.flash("messages", [result.message, false]);
        return res.redirect("/login");
    } catch (error) {
        return next(error);
    }
});

router.get("/index", async (req, res, next) => {
    try {
        const user = req.user;
        const [usersData, groups, adminUsers, chatPreferences, statuses] = await Promise.all([
            sobj.fetchAllUser(),
            sobj.fetchGroupsForUser(user.id),
            user.role === "admin" ? sobj.fetchAdminUsers() : Promise.resolve([]),
            sobj.fetchChatPreferences(user.id),
            sobj.fetchUserStatuses(),
        ]);
        if (user.role === "admin" && !req.session.adminCsrfToken) {
            req.session.adminCsrfToken = randomBytes(32).toString("hex");
        }
        res.render("index", {
            user,
            contacts: usersData,
            groups,
            chatPreferences,
            statuses,
            adminUsers,
            adminCsrfToken: user.role === "admin" ? req.session.adminCsrfToken : "",
            groupSuccess: req.flash("groupSuccess")[0],
            groupError: req.flash("groupError")[0],
            profileSuccess: req.flash("profileSuccess")[0],
            profileError: req.flash("profileError")[0],
            adminSuccess: req.flash("adminSuccess")[0],
            adminError: req.flash("adminError")[0],
        });
    } catch (error) {
        next(error);
    }
});

router.post("/admin/users/:id/access", requireAdmin, async (req, res, next) => {
    if (!isValidAdminCsrfToken(req.session.adminCsrfToken, req.body.csrfToken)) {
        return res.status(403).send("Your session token is invalid. Reload the page and try again.");
    }

    const targetId = typeof req.params.id === "string" ? req.params.id : "";
    const role = req.body.role;
    const isActive = req.body.isActive === "true"
        ? true
        : req.body.isActive === "false"
            ? false
            : null;
    if (!/^[1-9]\d*$/.test(targetId) || !["admin", "user"].includes(role) || isActive === null) {
        req.flash("adminError", "Choose a valid role and account-access setting.");
        return res.redirect("/index");
    }

    try {
        const result = await sobj.updateUserAccess(req.user.id, targetId, role, isActive);
        if (!result.ok) {
            req.flash("adminError", result.message);
            return res.redirect("/index");
        }

        const io = req.app.get("io");
        if (io) {
            for (const socket of io.sockets.sockets.values()) {
                if (String(socket.request.user && socket.request.user.id) !== targetId) continue;
                socket.request.user.role = result.user.role;
                socket.request.user.isActive = result.user.isActive;
                if (!result.user.isActive) socket.disconnect(true);
            }
        }

        req.flash("adminSuccess", `Access updated for ${result.user.name}.`);
        return res.redirect("/index");
    } catch (error) {
        return next(error);
    }
});

router.post("/profile", async (req, res, next) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const about = typeof req.body.about === "string" ? req.body.about.trim() : "";

    if (name.length < 1 || name.length > 40) {
        req.flash("profileError", "Your name must be between 1 and 40 characters.");
        return res.redirect("/index");
    }

    if (about.length > 160) {
        req.flash("profileError", "Your about message must be 160 characters or fewer.");
        return res.redirect("/index");
    }

    try {
        await sobj.updateUserProfile(req.user.id, name, about);
        req.flash("profileSuccess", "Your profile was updated.");
        res.redirect("/index");
    } catch (error) {
        next(error);
    }
});

router.post("/profile-picture", profilePictureUpload, handleProfilePictureUploadError, async (req, res, next) => {
    if (!req.profilePicture) {
        return res.status(400).json({ error: "Choose an image to upload." });
    }

    try {
        const updatedUser = await sobj.updateProfilePicture(req.user.id, req.profilePicture);
        if (!updatedUser) {
            return res.status(404).json({ error: "User account was not found." });
        }

        const io = req.app.get("io");
        if (io) {
            for (const socket of io.sockets.sockets.values()) {
                if (String(socket.request.user && socket.request.user.id) === String(req.user.id)) {
                    socket.request.user.img = updatedUser.img;
                }
            }
            io.emit("profile-picture-updated", {
                userId: String(req.user.id),
                contactNo: req.user.contactNo,
                img: updatedUser.img,
            });
        }

        return res.json({ img: updatedUser.img });
    } catch (error) {
        return next(error);
    }
});

router.get("/statuses", async (req, res, next) => {
    try {
        res.set("Cache-Control", "no-store");
        res.json({ statuses: await sobj.fetchUserStatuses() });
    } catch (error) {
        next(error);
    }
});

router.post("/statuses", async (req, res, next) => {
    const body = req.body || {};
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content || content.length > 280) {
        return res.status(400).json({ error: "Status updates must be 1 to 280 characters." });
    }
    try {
        const status = await sobj.createUserStatus(req.user.id, content);
        res.status(201).json({ status });
    } catch (error) {
        next(error);
    }
});

router.post("/chat-preferences", async (req, res, next) => {
    const { chatType, conversationId, preference, value } = req.body || {};
    if (!["direct", "group"].includes(chatType) ||
        typeof conversationId !== "string" || !conversationId ||
        !["pinned", "archived"].includes(preference) ||
        typeof value !== "boolean" ||
        (chatType === "group" && !/^[1-9]\d*$/.test(conversationId)) ||
        (chatType === "direct" && conversationId.length > 64)) {
        return res.status(400).json({ error: "Invalid chat preference." });
    }
    try {
        const result = await sobj.updateChatPreference(
            req.user.id, chatType, conversationId, preference, value
        );
        res.json({ preference: result });
    } catch (error) {
        if (error.message.includes("not available")) {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
});

router.get("/search", async (req, res, next) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query.length > 80) {
        return res.status(400).json({ error: "Search terms must be 80 characters or fewer." });
    }

    if (!query) {
        return res.json({ results: [] });
    }

    try {
        const results = await sobj.searchChatsForUser(req.user.id, req.user.contactNo, query);
        res.json({ results });
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
