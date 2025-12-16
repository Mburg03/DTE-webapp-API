const errorHandler = (err, req, res, next) => {
    // Si el status code es 200 (ok), lo cambiamos a 500 (error interno)
    // porque si llegamos aquí, ALGO salió mal.
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    res.status(statusCode);

    res.json({
        message: err.message,
        // En producción no queremos mostrar el stack trace (detalles técnicos)
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};

module.exports = { errorHandler };
