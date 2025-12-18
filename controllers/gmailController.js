const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const GmailConnection = require('../models/GmailConnection');
const { encrypt } = require('../utils/encryption');
const {
    getAuthUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    getUserProfile
} = require('../services/gmailService');

// Genera un token breve en "state" para saber qué usuario inició el OAuth (sin usar frontend)
const createState = (userId) => {
    return jwt.sign({ uid: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
};

// @desc    Redirige a Google OAuth (devuelve la URL)
// @route   GET /api/gmail/auth
// @access  Private
exports.startAuth = asyncHandler(async (req, res) => {
    const state = createState(req.user.id);
    const url = getAuthUrl(state);
    res.json({ url });
});

// @desc    Callback de Google OAuth
// @route   GET /api/gmail/callback
// @access  Public (validamos state para saber el usuario)
exports.handleCallback = asyncHandler(async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state) {
        res.status(400);
        throw new Error('Missing code or state');
    }

    let decoded;
    try {
        decoded = jwt.verify(state, process.env.JWT_SECRET);
    } catch (err) {
        res.status(400);
        throw new Error('Invalid or expired state');
    }

    const userId = decoded.uid;

    // Intercambiar code por tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
        res.status(400);
        throw new Error('No refresh_token received. Try again with consent prompt.');
    }

    // Obtener email conectado
    const profile = await getUserProfile(tokens.access_token);
    const email = profile.emailAddress;

    // Guardar/actualizar conexión
    const encryptedRefresh = encrypt(tokens.refresh_token);

    await GmailConnection.findOneAndUpdate(
        { user: userId },
        { user: userId, email, refreshToken: encryptedRefresh },
        { upsert: true, new: true }
    );

    // Si FRONTEND_URL está configurado, redirigimos al dashboard
    if (process.env.FRONTEND_URL) {
        return res.redirect(`${process.env.FRONTEND_URL}/?gmail=connected`);
    }

    res.json({ msg: 'Gmail connected', email });
});

// @desc    Buscar y descargar facturas
// @route   POST /api/gmail/search
// @access  Private
exports.searchInvoices = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.body; // Formato preferido: YYYY/MM/DD o YYYY-MM-DD
    const userId = req.user.id; // Del middleware auth

    if (!startDate || !endDate) {
        res.status(400);
        throw new Error('startDate and endDate are required (YYYY/MM/DD)');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400);
        throw new Error('Invalid date format. Use YYYY/MM/DD or YYYY-MM-DD');
    }

    if (start > end) {
        res.status(400);
        throw new Error('startDate must be before endDate');
    }
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDays > 31) {
        res.status(400);
        throw new Error('Date range too large. Please request up to 31 days.');
    }

    // Gmail before es exclusivo, sumamos 1 día para que incluya endDate
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() + 1);

    // 1. Access token fresco
    const accessToken = await exports.getFreshAccessToken(userId);

    // 2. Generar etiqueta de lote (ej: 2024-11)
    const batchLabel = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;

    // 3. Procesar (limitamos mensajes para no pasar el quota)
    try {
        // Obtener keywords custom del usuario
        const Keywords = require('../models/Keywords');
        const kwDoc = await Keywords.findOne({ user: userId });
        const customKeywords = kwDoc?.custom || [];

        const results = await require('../services/gmailService').processInvoices({
            accessToken,
            startEpoch: Math.floor(start.getTime() / 1000),
            endEpoch: Math.floor(endInclusive.getTime() / 1000),
            userId,
            batchLabel,
            maxMessages: 100, // límite razonable de facturas por paquete
            customKeywords
        });
        res.json({ msg: 'Search complete', results });
    } catch (error) {
        console.error(error);
        if (error.code === 'REAUTH_REQUIRED') {
            res.status(401);
            throw new Error('Gmail access expired. Please reconnect.');
        }
        res.status(500);
        throw new Error('Error processing invoices: ' + error.message);
    }
});

// @desc    Estado de conexión Gmail
// @route   GET /api/gmail/status
// @access  Private
exports.status = asyncHandler(async (req, res) => {
    const conn = await GmailConnection.findOne({ user: req.user.id }).select('-refreshToken');
    if (!conn) {
        return res.json({ connected: false });
    }
    res.json({
        connected: true,
        email: conn.email,
        connectedAt: conn.createdAt
    });
});

// @desc    Desconectar Gmail (elimina refresh_token)
// @route   DELETE /api/gmail
// @access  Private
exports.disconnect = asyncHandler(async (req, res) => {
    await GmailConnection.findOneAndDelete({ user: req.user.id });
    res.json({ msg: 'Gmail disconnected' });
});

// Helper para obtener access_token fresco; si falla, pide reconexión
exports.getFreshAccessToken = async (userId) => {
    const conn = await GmailConnection.findOne({ user: userId });
    if (!conn) {
        const err = new Error('Gmail not connected');
        err.code = 'NOT_CONNECTED';
        throw err;
    }
    try {
        const credentials = await refreshAccessToken(conn.refreshToken);
        if (!credentials?.access_token) {
            const err = new Error('Unable to refresh access token');
            err.code = 'REFRESH_FAILED';
            throw err;
        }
        return credentials.access_token;
    } catch (err) {
        if (err.code === 'DECRYPT_FAILED') throw err;
        const error = new Error(err.message || 'Refresh token invalid or expired');
        error.code = err.code === 'REFRESH_FAILED' ? 'REAUTH_REQUIRED' : err.code;
        throw error;
    }
};
