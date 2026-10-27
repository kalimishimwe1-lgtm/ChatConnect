module.exports = (req, res, next) => {
    if (!req.user || req.user.role !== "admin" || !req.user.isActive) {
        return res.status(403).send("Administrator access is required.");
    }

    next();
};
