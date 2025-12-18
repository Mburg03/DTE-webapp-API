require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorMiddleware');

const app = express();

// Max 100 peticiones por 15 minutos por IP, para seguridad
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Demasiadas peticiones. Por favor, intenta de nuevo en 15 minutos.'
});

// Basic env validation to fail fast on missing secrets
const requiredEnv = [
    'MONGO_URI',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'S3_BUCKET'
];
requiredEnv.forEach((key) => {
    if (!process.env[key]) {
        console.error(`Missing required env var: ${key}`);
        process.exit(1);
    }
});

// Connect Database
connectDB();

// Middleware
// Límite de body para evitar payloads grandes
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

// En producción exigimos que se configure al menos un origen
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    console.error('CORS_ORIGIN must be set in production');
    process.exit(1);
}

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow server-to-server or tools like Postman (no origin)
            if (!origin) return callback(null, true);
            if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true
    })
);
app.use(helmet());
// Logging: verbose en dev, combined en prod
if (process.env.NODE_ENV === 'production') {
    app.use(morgan('combined'));
} else {
    app.use(morgan('dev'));
}

// En producción, exigir HTTPS (Railway envía x-forwarded-proto)
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        const proto = req.get('x-forwarded-proto');
        if (proto && proto !== 'https') {
            return res.status(400).json({ message: 'HTTPS required' });
        }
        return next();
    });
}

// Routes
app.use('/api/auth', limiter, require('./routes/auth'));
app.use('/api/gmail', limiter, require('./routes/gmail'));
app.use('/api/keywords', limiter, require('./routes/keywords'));
app.use('/api/packages', limiter, require('./routes/packages'));
app.use('/api/admin', limiter, require('./routes/admin'));

app.get('/', limiter, (req, res) => {
    res.json({ msg: 'Factura Automate API Running' });
});


// 404 handler
app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
});

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
