module.exports = (req,res,next) => {
	const user = req.user;
	if (typeof user === "undefined") {
        if (req.originalUrl === '/login' || req.originalUrl === '/register' || req.originalUrl === '/password') {
            return next();
        } else {
            return res.redirect('/login');
        }
    }
	if (!user.isActive) {
	    return req.logout((error) => {
	        if (error) return next(error);
	        req.session.destroy((sessionError) => {
	            if (sessionError) return next(sessionError);
	            res.clearCookie("connect.sid");
	            res.redirect("/login");
	        });
	    });
	}
	next();
};