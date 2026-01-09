const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const GmailConnection = require('../models/GmailConnection');
const User = require('../models/User');
const Package = require('../models/Package');
const { encrypt } = require('../utils/encryption');
const ReplaceIntent = require('../models/ReplaceIntent');
const {
    getAuthUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    getUserProfile
} = require('../services/gmailService');
const { plans } = require('../config/plans');

// Genera un token breve en "state" para saber qué usuario inició el OAuth (sin usar frontend)
const createState = (userId, intentId = null) => {
    return jwt.sign({ uid: userId, intentId }, process.env.JWT_SECRET, { expiresIn: '10m' });
};

const canReplace = (user, planConfig) => {
    const windowDays = planConfig.replaceWindowDays || 30;
    const quota = planConfig.replaceQuota || 0;
    const now = new Date();
    let windowStart = user.replaceWindowStart;
    let count = user.replaceCount || 0;

    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    if (!windowStart || now - windowStart > windowMs) {
        windowStart = now;
        count = 0;
    }

    if (count >= quota) {
        const next = new Date(windowStart.getTime() + windowMs);
        return { ok: false, nextAvailableAt: next };
    }
    return { ok: true, windowStart, count };
};

const registerReplace = async (user, planConfig) => {
    const result = canReplace(user, planConfig);
    if (!result.ok) return result;
    user.replaceWindowStart = result.windowStart || new Date();
    user.replaceCount = (result.count || 0) + 1;
    await user.save();
    return { ok: true };
};

// @desc    Redirige a Google OAuth (devuelve la URL)
// @route   GET /api/gmail/auth
// @access  Private
exports.startAuth = asyncHandler(async (req, res) => {
    const state = createState(req.user.id);
    const url = getAuthUrl(state);
    res.json({ url });
});

// @desc    Iniciar flujo de reemplazo de cuenta (usa intent)
// @route   POST /api/gmail/replace
// @access  Private
exports.startReplace = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { targetAccountId } = req.body;
    if (!targetAccountId) {
        res.status(400);
        throw new Error('Cuenta objetivo requerida');
    }
    const user = await User.findById(userId);
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    if (user.planStatus !== 'active') {
        res.status(403);
        throw new Error('Plan inactivo. Actualiza tu suscripción.');
    }
    const planConfig = plans[user.plan] || plans.personal;
    const target = await GmailConnection.findOne({ _id: targetAccountId, user: userId, status: 'active' });
    if (!target) {
        res.status(404);
        throw new Error('Cuenta a reemplazar no encontrada');
    }

    const can = canReplace(user, planConfig);
    if (!can.ok) {
        res.status(429);
        throw new Error(`Próximo cambio disponible: ${can.nextAvailableAt.toISOString().slice(0, 10)}`);
    }

    // Crear intent con expiración breve
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const intent = await ReplaceIntent.create({
        user: userId,
        targetAccountId,
        expiresAt
    });

    const state = createState(userId, intent._id.toString());
    const url = getAuthUrl(state);
    res.json({ url, intentId: intent._id });
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
    const intentId = decoded.intentId;

    // Intercambiar code por tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
        res.status(400);
        throw new Error('No refresh_token received. Try again with consent prompt.');
    }

    // Obtener email conectado
    const profile = await getUserProfile(tokens.access_token);
    const email = profile.emailAddress;

    // Verificar plan y cupo de cuentas
    const user = await User.findById(userId);
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    if (user.planStatus !== 'active') {
        res.status(403);
        throw new Error('Plan inactivo. Actualiza tu suscripción.');
    }
    const planConfig = plans[user.plan] || plans.personal;

    // Si hay intent, es reemplazo; si no, es alta normal
    let isReplacement = false;
    let targetAccount = null;
    if (intentId) {
        const intent = await ReplaceIntent.findOne({ _id: intentId, user: userId });
        if (!intent || intent.expiresAt < new Date()) {
            res.status(400);
            throw new Error('Intento de reemplazo expirado o inválido');
        }
        targetAccount = await GmailConnection.findOne({ _id: intent.targetAccountId, user: userId, status: 'active' });
        if (!targetAccount) {
            res.status(400);
            throw new Error('Cuenta objetivo no encontrada o no activa');
        }
        isReplacement = true;
        // Eliminamos el intent usado
        await ReplaceIntent.deleteOne({ _id: intentId });
    }

    // ¿Ya existe esta cuenta?
    const existing = await GmailConnection.findOne({ user: userId, email });
    const encryptedRefresh = encrypt(tokens.refresh_token);

    if (isReplacement) {
        // Si es el mismo email (reautorizar): solo actualiza token sin consumir reemplazo
        if (targetAccount.email === email) {
            targetAccount.refreshToken = encryptedRefresh;
            targetAccount.status = 'active';
            targetAccount.primary = true;
            targetAccount.disabledAt = null;
            targetAccount.authState = 'ok';
            targetAccount.lastAuthError = null;
            targetAccount.lastAuthErrorAt = null;
            await targetAccount.save();
            await GmailConnection.updateMany(
                { user: userId, _id: { $ne: targetAccount._id } },
                { $set: { primary: false } }
            );
        } else {
            // Email nuevo: reemplazo real
            const can = await registerReplace(user, planConfig);
            if (!can.ok) {
                res.status(429);
                throw new Error(can.message || 'Límite de reemplazos alcanzado');
            }
            // Desactivar la cuenta objetivo
            targetAccount.status = 'disabled';
            targetAccount.disabledAt = new Date();
            await targetAccount.save();
            // Crear/activar la nueva
            if (existing) {
                existing.refreshToken = encryptedRefresh;
                existing.status = 'active';
                existing.primary = true;
                existing.disabledAt = null;
                existing.authState = 'ok';
                existing.lastAuthError = null;
                existing.lastAuthErrorAt = null;
                await existing.save();
            } else {
                await GmailConnection.create({
                    user: userId,
                    email,
                    refreshToken: encryptedRefresh,
                    status: 'active',
                    authState: 'ok',
                    primary: true
                });
            }
            await GmailConnection.updateMany(
                { user: userId, _id: { $ne: targetAccount._id }, email: { $ne: email } },
                { $set: { primary: false } }
            );
        }
    } else {
        // Alta normal (sin intent)
        if (!existing) {
            const totalDistinct = await GmailConnection.countDocuments({ user: userId });
            if (totalDistinct >= planConfig.gmailLimit) {
                res.status(403);
                throw new Error('Límite de cuentas Gmail alcanzado. Usa reemplazo para cambiar una cuenta existente.');
            }
            const countActive = await GmailConnection.countDocuments({ user: userId, status: 'active' });
            if (countActive >= planConfig.gmailLimit) {
                res.status(403);
                throw new Error('Límite de cuentas Gmail alcanzado. Reemplaza o desactiva una antes de agregar otra.');
            }
            const hasPrimary = await GmailConnection.exists({ user: userId, primary: true, status: 'active' });
            await GmailConnection.create({
                user: userId,
                email,
                refreshToken: encryptedRefresh,
                status: 'active',
                authState: 'ok',
                primary: !hasPrimary
            });
        } else {
            existing.refreshToken = encryptedRefresh;
            existing.status = 'active';
            const hasPrimary = await GmailConnection.exists({ user: userId, primary: true, status: 'active' });
            if (!hasPrimary) existing.primary = true;
            existing.disabledAt = null;
            existing.authState = 'ok';
            existing.lastAuthError = null;
            existing.lastAuthErrorAt = null;
            await existing.save();
        }
    }

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
        throw new Error('La fecha de inicio debe ser anterior a la fecha de fin.');
    }
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDays > 31) {
        res.status(400);
        throw new Error('Date range too large. Please request up to 31 days.');
    }

    // Gmail before es exclusivo, sumamos 1 día para que incluya endDate
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() + 1);

    // 1. Obtener la conexión (si hay varias, requerimos seleccionar una)
    const connections = await GmailConnection.find({ user: userId, status: 'active' });
    if (!connections.length) {
        res.status(400);
        throw new Error('No tienes cuentas Gmail conectadas');
    }
    let targetConn = connections[0];
    if (connections.length > 1) {
        const { accountId } = req.body;
        if (!accountId) {
            res.status(400);
            throw new Error('Debes seleccionar una cuenta de Gmail');
        }
        targetConn = connections.find((c) => String(c._id) === String(accountId));
        if (!targetConn) {
            res.status(400);
            throw new Error('Cuenta seleccionada no válida');
        }
    }

    // Esta ruta ya no se usa; generación se hace en packagesController
    res.status(410).json({ msg: 'Endpoint deprecated' });
});

// @desc    Estado de conexión Gmail
// @route   GET /api/gmail/status
// @access  Private
exports.status = asyncHandler(async (req, res) => {
    const conns = await GmailConnection.find({ user: req.user.id, status: { $in: ['active', 'disabled'] } }).select('-refreshToken');
    const activeConns = conns.filter((c) => c.status === 'active');
    const activeOk = activeConns.filter((c) => (c.authState || 'ok') !== 'expired');
    if (!conns.length) {
        return res.json({ connected: false, accounts: [] });
    }

    // Stats por cuenta (último paquete y totales)
    const accountIds = conns.map((c) => c._id);
    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const singleAccount = conns.length === 1 ? accountIds[0] : null;
    const matchStage =
        singleAccount
            ? {
                  user: userObjectId,
                  $or: [{ accountId: singleAccount }, { accountId: { $exists: false } }, { accountId: null }]
              }
            : { user: userObjectId, accountId: { $in: accountIds } };

    const statsByAccount = await Package.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: '$accountId',
                totalPackages: { $sum: 1 },
                totalJson: { $sum: '$jsonCount' },
                totalPdf: { $sum: '$pdfCount' },
                lastPackageAt: { $max: '$createdAt' }
            }
        }
    ]);
    const statsMap = {};
    statsByAccount.forEach((s) => {
        statsMap[String(s._id)] = s;
    });

    const accounts = conns.map((c) => {
        // Para singleAccount, si stats vienen con _id null, asígnalos a esa cuenta
        const st = statsMap[String(c._id)] || statsMap['null'] || {};
        return {
            id: c._id,
            email: c.email,
            connectedAt: c.createdAt,
            primary: !!c.primary,
            status: c.status,
            authState: c.authState || 'ok',
            authError: c.lastAuthError || null,
            stats: {
                totalPackages: st.totalPackages || 0,
                totalJson: st.totalJson || 0,
                totalPdf: st.totalPdf || 0,
                lastPackageAt: st.lastPackageAt || null
            }
        };
    });

    res.json({
        connected: activeOk.length > 0,
        accounts
    });
});

// @desc    Desconectar Gmail (desactiva la cuenta, no la borra)
// @route   DELETE /api/gmail/:id
// @access  Private
exports.disconnect = asyncHandler(async (req, res) => {
    const conn = await GmailConnection.findOne({ user: req.user.id, _id: req.params.id });
    if (!conn) {
        res.status(404);
        throw new Error('Cuenta no encontrada');
    }
    const wasPrimary = conn.primary;
    conn.status = 'disabled';
    conn.primary = false;
    conn.disabledAt = new Date();
    await conn.save();

    // Si era primary, asignar otra como primary si existe
    if (wasPrimary) {
        await GmailConnection.findOneAndUpdate(
            { user: req.user.id, status: 'active' },
            { $set: { primary: true } },
            { sort: { createdAt: 1 } }
        );
    }

    res.json({ msg: 'Cuenta desactivada', email: conn.email });
});

// Helper para obtener access_token fresco; si falla, pide reconexión
exports.getFreshAccessToken = async (userId, accountId = null) => {
    const filter = accountId
        ? { user: userId, _id: accountId, status: 'active' }
        : { user: userId, status: 'active', primary: true };
    const conn = await GmailConnection.findOne(filter);
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
        if (conn.authState === 'expired' || conn.lastAuthError) {
            conn.authState = 'ok';
            conn.lastAuthError = null;
            conn.lastAuthErrorAt = null;
            await conn.save();
        }
        return credentials.access_token;
    } catch (err) {
        if (err.code === 'DECRYPT_FAILED') throw err;
        conn.authState = 'expired';
        conn.lastAuthError = err.message || 'Refresh token invalid or expired';
        conn.lastAuthErrorAt = new Date();
        await conn.save();
        const error = new Error('Token de Google expirado o revocado. Reconecta tu cuenta.');
        error.code = err.code === 'REFRESH_FAILED' ? 'REAUTH_REQUIRED' : err.code;
        throw error;
    }
};

// @desc    Marcar una cuenta como primaria (activa por defecto)
// @route   PATCH /api/gmail/:id/activate
// @access  Private
exports.activate = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const accountId = req.params.id;
    const target = await GmailConnection.findOne({ _id: accountId, user: userId, status: 'active' });
    if (!target) {
        res.status(404);
        throw new Error('Cuenta no encontrada o no activa');
    }
    await GmailConnection.updateMany({ user: userId }, { $set: { primary: false } });
    target.primary = true;
    await target.save();
    res.json({ msg: 'Cuenta activada como principal' });
});
