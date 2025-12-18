const asyncHandler = require('express-async-handler');
const Keywords = require('../models/Keywords');
const { baseKeywords } = require('../config/searchConfig');

// Normaliza una keyword: trim y lowercase
const normalize = (k = '') => k.trim().toLowerCase();

// @desc    Obtener keywords (base + custom)
// @route   GET /api/keywords
// @access  Private
exports.getKeywords = asyncHandler(async (req, res) => {
    const existing = await Keywords.findOne({ user: req.user.id });

    const data = existing || { base: baseKeywords, custom: [] };

    res.json({
        base: data.base.length ? data.base : baseKeywords,
        custom: data.custom || []
    });
});

// @desc    Agregar keyword custom
// @route   POST /api/keywords
// @access  Private
exports.addKeyword = asyncHandler(async (req, res) => {
    const { keyword } = req.body;
    const raw = keyword ? keyword.trim() : '';
    if (!raw) {
        res.status(400);
        throw new Error('Keyword is required');
    }

    // Permitir letras/números/espacios/puntos/guiones/guiones bajos (incluye acentos)
    const pattern = /^[\p{L}\p{N}\s._-]{2,50}$/u;
    if (!pattern.test(raw)) {
        res.status(400);
        throw new Error('Keyword inválida. Usa letras, números y guiones/puntos (2-50 chars)');
    }

    const norm = normalize(raw);
    if (norm.length < 2 || norm.length > 50) {
        res.status(400);
        throw new Error('Keyword must be between 2 and 50 characters');
    }

    // No permitir duplicados con base ni con custom
    if (baseKeywords.map(normalize).includes(norm)) {
        res.status(400);
        throw new Error('Keyword already exists in base list');
    }

    let keywords = await Keywords.findOne({ user: req.user.id });
    if (!keywords) {
        keywords = new Keywords({ user: req.user.id, base: baseKeywords, custom: [] });
    }

    const customNorm = keywords.custom.map(normalize);
    if (customNorm.includes(norm)) {
        res.status(400);
        throw new Error('Keyword already exists in custom list');
    }

    keywords.custom.push(keyword.trim());
    await keywords.save();

    res.status(201).json({ custom: keywords.custom });
});

// @desc    Eliminar keyword custom
// @route   DELETE /api/keywords/:keyword
// @access  Private
exports.deleteKeyword = asyncHandler(async (req, res) => {
    const kw = req.params.keyword;
    if (!kw) {
        res.status(400);
        throw new Error('Keyword param is required');
    }
    const norm = normalize(kw);

    const keywords = await Keywords.findOne({ user: req.user.id });
    if (!keywords) {
        res.status(404);
        throw new Error('No custom keywords found');
    }

    const before = keywords.custom.length;
    keywords.custom = keywords.custom.filter((k) => normalize(k) !== norm);

    if (keywords.custom.length === before) {
        res.status(404);
        throw new Error('Keyword not found in custom list');
    }

    await keywords.save();
    res.json({ custom: keywords.custom });
});
