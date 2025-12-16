module.exports = (roles = []) => {
    return (req, res, next) => {
        const userRole = req.user?.role || 'viewer';
        const allowed = Array.isArray(roles) ? roles : [roles];
        if (allowed.includes(userRole)) {
            return next();
        }
        return res.status(403).json({ msg: 'No tienes permisos para realizar esta acción' });
    };
};
