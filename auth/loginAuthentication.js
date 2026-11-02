module.exports = (req,res,next) => {
	const user = req.user;
	if (typeof user === "undefined") {
        if (
            req.path === "/login" ||
            req.path === "/register" ||
            req.path === "/password" ||
            req.path === "/wallet/challenge" ||
            req.path === "/wallet/login"
        ) {
            return next();
        } else {
            return res.redirect('/login');
        }
    }
	next();
};