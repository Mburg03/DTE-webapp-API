const asyncHandler = require('express-async-handler');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Package = require('../models/Package');
const Keywords = require('../models/Keywords');
const GmailConnection = require('../models/GmailConnection');
const UsageMonth = require('../models/UsageMonth');
const User = require('../models/User');
const { getFreshAccessToken } = require('./gmailController');
const { processInvoices } = require('../services/gmailService');
const { zipDirectory, cleanOldZips } = require('../services/zipService');
const { uploadZip, getDownloadUrl } = require('../services/storageService');
const { plans } = require('../config/plans');

const parseDates = (startDate, endDate) => {
    if (!startDate || !endDate) {
        const err = new Error('startDate and endDate are required');
        err.status = 400;
        throw err;
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        const err = new Error('Invalid date format. Use YYYY-MM-DD');
        err.status = 400;
        throw err;
    }
    if (start > end) {
        const err = new Error('La fecha de inicio debe ser anterior a la fecha de fin.');
        err.status = 400;
        throw err;
    }
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (start > today || end > today) {
        const err = new Error('Dates cannot be in the future');
        err.status = 400;
        throw err;
    }
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDays > 31) {
        const err = new Error('Date range too large. Please request up to 31 days.');
        err.status = 400;
        throw err;
    }
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() + 1);
    return {
        startEpoch: Math.floor(start.getTime() / 1000),
        endEpoch: Math.floor(endInclusive.getTime() / 1000),
        batchLabel: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
    };
};

const getCurrentPeriod = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// @desc Generar paquete ZIP con facturas
// @route POST /api/packages/generate
// @access Private
exports.generate = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { startDate, endDate } = req.body;

    const { startEpoch, endEpoch, batchLabel } = parseDates(startDate, endDate);
    const startStr = new Date(startDate).toISOString().slice(0, 10);
    const endStr = new Date(endDate).toISOString().slice(0, 10);
    const includeSpam = !!req.body.includeSpam; // opcional, para buscar también en spam

    // Limpieza preventiva de zips viejos
    const baseDir = path.join(__dirname, '../uploads/zips');
    cleanOldZips(baseDir, 24);

    // Verificar plan y uso
    const user = await User.findById(userId);
    if (!user) {
        res.status(404);
        throw new Error('User not found');
    }
    if (user.planStatus !== 'active') {
        res.status(403);
        throw new Error('Plan inactivo. Actualiza tu suscripción.');
    }
    const planConfig = plans[user.plan] || plans.personal;
    const period = getCurrentPeriod();
    let usage = await UsageMonth.findOne({ user: userId, period });
    if (!usage) {
        usage = await UsageMonth.create({ user: userId, period, dteCount: 0 });
    }
    const remainingDtes = planConfig.dteLimit - usage.dteCount;
    if (remainingDtes <= 0) {
        res.status(403);
        throw new Error('Límite de DTEs alcanzado para este mes.');
    }

    // Seleccionar cuenta Gmail
    const connections = await GmailConnection.find({ user: userId, status: 'active' });
    if (!connections.length) {
        res.status(400);
        throw new Error('No tienes cuentas Gmail conectadas');
    }
    let targetConn = connections[0];
    if (connections.length > 1) {
        const { accountId } = req.body;
        if (accountId) {
            targetConn = connections.find((c) => String(c._id) === String(accountId));
            if (!targetConn) {
                res.status(400);
                throw new Error('Cuenta seleccionada no válida');
            }
        } else {
            // intenta usar primary
            const primary = connections.find((c) => c.primary);
            if (primary) {
                targetConn = primary;
            } else {
                res.status(400);
                throw new Error('Debes seleccionar una cuenta de Gmail');
            }
        }
    }

    // Access token fresco
    let accessToken;
    try {
        accessToken = await require('./gmailController').getFreshAccessToken(targetConn.user, targetConn._id);
    } catch (err) {
        if (err.code === 'REAUTH_REQUIRED') {
            res.status(401);
            throw err;
        }
        throw err;
    }

    // Keywords
    const kwDoc = await Keywords.findOne({ user: userId });
    const customKeywords = kwDoc?.custom || [];

    // Descargar adjuntos en estructura
    const results = await processInvoices({
        accessToken,
        startEpoch,
        endEpoch,
        userId,
        batchLabel,
        maxMessages: 100,
        customKeywords,
        maxDtes: remainingDtes,
        includeSpam
    });

    // Crear ZIP del directorio (fuera del source para no incluirlo dentro)
    const sourceDir = results.outputDir;
    // Info adicional antes de comprimir
    const conn = await GmailConnection.findOne({ user: userId });
    const infoContent = [
        `Batch: ${startStr} a ${endStr}`,
        `Extraído de: ${conn?.email || 'desconocido'}`,
        `Fecha actual: ${new Date().toISOString()}`
    ].join('\n');
    fs.writeFileSync(path.join(sourceDir, 'INFO.txt'), infoContent);

    const zipPath = path.join(path.dirname(sourceDir), `${batchLabel}.zip`);
    const { size } = await zipDirectory(sourceDir, zipPath);

    // Validar tamaño máximo de ZIP por plan antes de subir
    const zipLimitBytes = planConfig.zipLimitBytes || 0;
    if (zipLimitBytes && size > zipLimitBytes) {
        try {
            fs.rmSync(sourceDir, { recursive: true, force: true });
            fs.rmSync(zipPath, { force: true });
        } catch (err) {
            console.warn('Could not remove temp dir after zip size check', err.message);
        }
        res.status(413);
        throw new Error(
            `El ZIP supera el límite de ${(zipLimitBytes / (1024 * 1024)).toFixed(0)} MB. Reduce el rango de fechas.`
        );
    }

    // Subir a S3
    const pkgId = new mongoose.Types.ObjectId();
    const storageKey = `zips/${userId}/${pkgId}.zip`;
    await uploadZip(zipPath, storageKey);

    // Opcional: limpiar archivos locales para no ocupar disco
    try {
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(zipPath, { force: true });
    } catch (err) {
        console.warn('Could not remove temp dir', err.message);
    }

    // Guardar metadatos
    const pkg = await Package.create({
        _id: pkgId,
        user: userId,
        accountId: targetConn._id,
        batchLabel,
        startDate: startStr,
        endDate: endStr,
        zipPath: storageKey, // guardamos la clave de storage para compatibilidad
        storageKey,
        storageProvider: 'aws',
        status: 'available',
        sizeBytes: size,
        filesSaved: results.filesSaved,
        messagesFound: results.messagesFound,
        pdfCount: results.pdfCount || 0,
        jsonCount: results.jsonCount || 0
    });

    // Actualizar uso (cuenta JSON como DTE)
    const dtesProcesados = Math.min(results.jsonCount || 0, remainingDtes);
    await UsageMonth.updateOne(
        { user: userId, period },
        { $inc: { dteCount: dtesProcesados } },
        { upsert: true }
    );

    res.json({
        msg: 'Package generated',
        packageId: pkg._id,
        storageKey,
        sizeBytes: size,
        summary: results,
        limitInfo: {
            plan: user.plan,
            limit: planConfig.dteLimit,
            usedBefore: usage.dteCount,
            usedAfter: usage.dteCount + dtesProcesados,
            remaining: Math.max(planConfig.dteLimit - (usage.dteCount + dtesProcesados), 0)
        }
    });
});

// @desc Descargar paquete ZIP
// @route GET /api/packages/download/:id
// @access Private
exports.download = asyncHandler(async (req, res) => {
    const pkg = await Package.findOne({ _id: req.params.id, user: req.user.id });
    if (!pkg) {
        res.status(404);
        throw new Error('Package not found');
    }
    if (pkg.status !== 'available') {
        res.status(404);
        throw new Error('Package expired or unavailable');
    }
    try {
        const desiredName = `${pkg.batchLabel}.zip`;
        const url = await getDownloadUrl(pkg.storageKey, 300, desiredName);
        // Si el frontend quiere la URL sin redirigir
        if (req.query.urlOnly === '1') {
            return res.json({ url });
        }
        return res.redirect(url);
    } catch (err) {
        if (err.code === 'STORAGE_NOT_FOUND') {
            res.status(404);
            throw new Error('Package not found in storage');
        }
        throw err;
    }
});

// @desc Listar paquetes del usuario (historial)
// @route GET /api/packages
// @access Private
exports.list = asyncHandler(async (req, res) => {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const reqLimit = parseInt(req.query.limit || '10', 10);
    const limit = Math.min(Math.max(reqLimit, 1), 50);
    const skip = (page - 1) * limit;

    const pipeline = [
        { $match: { user: new mongoose.Types.ObjectId(req.user.id) } },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
            $lookup: {
                from: 'gmailconnections',
                localField: 'accountId',
                foreignField: '_id',
                as: 'account'
            }
        },
        {
            $addFields: {
                accountEmail: { $arrayElemAt: ['$account.email', 0] }
            }
        },
        { $project: { account: 0 } }
    ];

    const [items, total] = await Promise.all([
        Package.aggregate(pipeline),
        Package.countDocuments({ user: req.user.id })
    ]);

    res.json({
        page,
        limit,
        total,
        items
    });
});

// @desc Último paquete del usuario
// @route GET /api/packages/latest
// @access Private
exports.latest = asyncHandler(async (req, res) => {
    const pkg = await Package.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(req.user.id) } },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
        {
            $lookup: {
                from: 'gmailconnections',
                localField: 'accountId',
                foreignField: '_id',
                as: 'account'
            }
        },
        {
            $addFields: {
                accountEmail: { $arrayElemAt: ['$account.email', 0] }
            }
        },
        { $project: { account: 0 } }
    ]);
    const latest = pkg[0];
    if (!latest) {
        return res.json(null);
    }
    res.json(latest);
});

// @desc Uso actual de DTEs del periodo vigente
// @route GET /api/packages/usage
// @access Private
exports.usage = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        res.status(404);
        throw new Error('User not found');
    }
    const planConfig = plans[user.plan] || plans.personal;
    const period = getCurrentPeriod();
    const usage = await UsageMonth.findOne({ user: req.user.id, period });
    const dteCount = usage?.dteCount || 0;
    res.json({
        plan: user.plan,
        planStatus: user.planStatus,
        period,
        limit: planConfig.dteLimit,
        zipLimitBytes: planConfig.zipLimitBytes || 0,
        used: dteCount,
        remaining: Math.max(planConfig.dteLimit - dteCount, 0)
    });
});
