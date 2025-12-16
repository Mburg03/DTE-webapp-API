const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    const authHeader = req.header('Authorization'); // Trae el header Authorization de la solicitud
    const fallbackToken = req.header('x-auth-token'); // Soporte para token en header alternativo por si algun cliente no puede usar Authorization
    const token = authHeader?.startsWith('Bearer ') // Si el header Authorization empieza con 'Bearer ', usa ese token
        ? authHeader.replace('Bearer ', '').trim()
        : fallbackToken;

    if (!token) {
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Aca revisa el token con el JWT_SECRET del archivo .env para ver si esta bien
        req.user = decoded.user; // lo decodifica y lo pone en req.user para que se pueda usar en las rutas protegidas
        next(); // sigue al siguiente middleware, es decir, dejalo pasar
    } catch (err) {
        res.status(401).json({ msg: 'Token is not valid' });
    }
};
