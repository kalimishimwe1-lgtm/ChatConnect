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
const { FEATURE_PERMISSIONS, FEATURE_KEYS } = require("../services/featurePermissions");
const { normalizeWalletAddress, verifyWalletChallenge } = require("../services/walletAuthentication");

router.use(flash());

router.use(requireAuth);

const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const saveSession = (req) => new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
});

const isValidAdminCsrfToken = (sessionToken, submittedToken) => {
    if (typeof sessionToken !== "string" || typeof submittedToken !== "string") {
        return false;
    }
    const expected = Buffer.from(sessionToken);
    const submitted = Buffer.from(submittedToken);
    return expected.length === submitted.length && timingSafeEqual(expected, submitted);
};

router.post("/wallet/challenge", async (req, res, next) => {
    const address = normalizeWalletAddress(req.body && req.body.address);
    const purpose = req.body && req.body.purpose;
    if (!address || !["login", "link"].includes(purpose)) {
        return res.status(400).json({ error: "Provide a valid wallet address and action." });
    }
    if (purpose === "link" && !req.user) {
        return res.status(401).json({ error: "Sign in before linking a wallet." });
    }
    if (purpose === "link" && !req.user.isActive) {
        return res.status(403).json({ error: "This account has been disabled." });
    }

    try {
        const origin = new URL(process.env.APP_URL || `${req.protocol}://${req.get("host")}`).origin;
        const issuedAt = new Date();
        const expiration = new Date(issuedAt.getTime() + WALLET_CHALLENGE_TTL_MS);
        const nonce = randomBytes(16).toString("hex");
        const action = purpose === "link" ? "link this wallet to your ChatConnect account" : "sign in to ChatConnect";
        const message = [
            `${new URL(origin).host} wants you to sign in with Ethereum:`,
            address,
            "",
            `Sign this one-time message to ${action}.`,
            "",
            `URI: ${origin}`,
            "Version: 1",
            `Nonce: ${nonce}`,
            `Issued At: ${issuedAt.toISOString()}`,
            `Expiration Time: ${expiration.toISOString()}`,
        ].join("\n");

        req.session.walletChallenge = {
            address,
            purpose,
            userId: purpose === "link" ? String(req.user.id) : null,
            message,
            expiresAt: expiration.getTime(),
        };
        await saveSession(req);
        return res.json({ message });
    } catch (error) {
        return next(error);
    }
});

router.post("/wallet/login", async (req, res, next) => {
    const challenge = req.session.walletChallenge;
    const address = normalizeWalletAddress(req.body && req.body.address);
    const signature = req.body && req.body.signature;
    req.session.walletChallenge = null;

    try {
        await saveSession(req);
        if (
            !challenge ||
            challenge.purpose !== "login" ||
            challenge.expiresAt < Date.now() ||
            !address ||
            address !== challenge.address ||
            !verifyWalletChallenge(challenge.message, signature, address)
        ) {
            return res.status(401).json({ error: "Wallet signature is invalid or expired. Please try again." });
        }

        const user = await sobj.getUserByWalletAddress(address);
        if (!user) {
            return res.status(404).json({ error: "This wallet is not linked to an account. Sign in with your phone number and link it first." });
        }
        if (!user.isActive) {
            return res.status(403).json({ error: "This account has been disabled. Contact an administrator." });
        }

        return req.logIn(user, (error) => {
            if (error) return next(error);
            return res.json({ ok: true, redirect: "/" });
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/wallet/link", async (req, res, next) => {
    const challenge = req.session.walletChallenge;
    const address = normalizeWalletAddress(req.body && req.body.address);
    const signature = req.body && req.body.signature;
    req.session.walletChallenge = null;

    try {
        await saveSession(req);
        if (
            !req.user ||
            !req.user.isActive ||
            !challenge ||
            challenge.purpose !== "link" ||
            challenge.userId !== String(req.user.id) ||
            challenge.expiresAt < Date.now() ||
            !address ||
            address !== challenge.address ||
            !verifyWalletChallenge(challenge.message, signature, address)
        ) {
            const status = req.user && !req.user.isActive ? 403 : 401;
            const error = status === 403
                ? "This account has been disabled."
                : "Wallet signature is invalid or expired. Please try again.";
            return res.status(status).json({ error });
        }

        const linkedWallet = await sobj.linkWalletAddress(req.user.id, address);
        if (!linkedWallet) {
            return res.status(409).json({ error: "This account already has a different wallet linked." });
        }
        return res.json({ ok: true, address: linkedWallet.walletAddress });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "This wallet is already linked to another account." });
        }
        return next(error);
    }
});

const requireFeature = (feature) => async (req, res, next) => {
    try {
        if (!(await sobj.isFeatureEnabled(req.user, feature))) {
            return res.status(403).send("This feature is currently disabled by an administrator.");
        }
        return next();
    } catch (error) {
        return next(error);
    }
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
        const [usersData, allGroups, adminUsers, featureSettings] = await Promise.all([
            sobj.fetchAllUser(),
            sobj.fetchGroupsForUser(user.id),
            user.role === "admin" ? sobj.fetchAdminUsers() : Promise.resolve([]),
            sobj.getFeatureSettings(),
        ]);
        const featurePermissions = user.role === "admin"
            ? FEATURE_KEYS.reduce((features, key) => {
                features[key] = true;
                return features;
            }, {})
            : featureSettings;
        if (user.role === "admin" && !req.session.adminCsrfToken) {
            req.session.adminCsrfToken = randomBytes(32).toString("hex");
        }
        res.render("index", {
            user,
            contacts: usersData,
            groups: featurePermissions.groups ? allGroups : [],
            adminUsers,
            featurePermissions,
            featureSettings,
            featureDefinitions: FEATURE_PERMISSIONS,
            adminCsrfToken: user.role === "admin" ? req.session.adminCsrfToken : "",
            groupSuccess: req.flash("groupSuccess")[0],
            groupError: req.flash("groupError")[0],
            profileSuccess: req.flash("profileSuccess")[0],
            profileError: req.flash("profileError")[0],
            adminSuccess: req.flash("adminSuccess")[0],
            adminError: req.flash("adminError")[0],
            featureSuccess: req.flash("featureSuccess")[0],
            featureError: req.flash("featureError")[0],
        });
    } catch (error) {
        next(error);
    }
});

router.post("/admin/feature-permissions", requireAdmin, async (req, res, next) => {
    if (!isValidAdminCsrfToken(req.session.adminCsrfToken, req.body.csrfToken)) {
        return res.status(403).send("Your session token is invalid. Reload the page and try again.");
    }

    const submittedFeatures = req.body.featurePermissions &&
        typeof req.body.featurePermissions === "object" &&
        !Array.isArray(req.body.featurePermissions)
        ? req.body.featurePermissions
        : {};
    const enabledFeatures = FEATURE_KEYS.filter((feature) =>
        submittedFeatures[feature] === "on"
    );

    try {
        const result = await sobj.updateFeatureSettings(req.user.id, enabledFeatures);
        if (!result.ok) {
            req.flash("featureError", result.message);
            return res.redirect("/index");
        }

        const io = req.app.get("io");
        if (io) io.emit("feature-permissions:updated", result.settings);
        req.flash("featureSuccess", "Feature access settings were updated.");
        return res.redirect("/index");
    } catch (error) {
        return next(error);
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

router.post("/profile", requireFeature("profile"), async (req, res, next) => {
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

router.post("/profile-picture", requireFeature("profile"), profilePictureUpload, handleProfilePictureUploadError, async (req, res, next) => {
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

router.get("/search", requireFeature("search"), async (req, res, next) => {
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

router.post("/groups", requireFeature("groups"), async (req, res, next) => {
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
