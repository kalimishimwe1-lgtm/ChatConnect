module.exports = (req,res,next) => {
	const user = req.user;
	if (typeof user === "undefined") {
        if (req.originalUrl === '/login' || req.originalUrl === '/register' || req.originalUrl === '/password') {
            return next();
        } else {
            return res.redirect('/login');
        }
    }
	next();
};