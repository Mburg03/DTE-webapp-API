const asyncHandler = require('express-async-handler');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Package = require('../models/Package');
const Keywords = require('../models/Keywords');
const GmailConnection = require('../models/GmailConnection');
const { getFreshAccessToken } = require('./gmailController');
const { processInvoices } = require('../services/gmailService');
const { zipDirectory, cleanOldZips } = require('../services/zipService');
const { uploadZip, getDownloadUrl } = require('../services/storageService');

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
        const err = new Error('startDate must be before endDate');
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

// @desc Generar paquete ZIP con facturas
// @route POST /api/packages/generate
// @access Private
exports.generate = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { startDate, endDate } = req.body;

    const { startEpoch, endEpoch, batchLabel } = parseDates(startDate, endDate);
    const startStr = new Date(startDate).toISOString().slice(0, 10);
    const endStr = new Date(endDate).toISOString().slice(0, 10);

    // Limpieza preventiva de zips viejos
    const baseDir = path.join(__dirname, '../uploads/zips');
    cleanOldZips(baseDir, 24);

    // Access token fresco
    const accessToken = await getFreshAccessToken(userId);

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
        customKeywords
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
        batchLabel,
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

    res.json({
        msg: 'Package generated',
        packageId: pkg._id,
        storageKey,
        sizeBytes: size,
        summary: results
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
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        Package.find({ user: req.user.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
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
    const pkg = await Package.findOne({ user: req.user.id }).sort({ createdAt: -1 }).lean();
    if (!pkg) {
        return res.json(null);
    }
    res.json(pkg);
});
