const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const PasswordReset = require('../models/PasswordReset');

const sanitizeEmail = (email = '') => email.trim().toLowerCase();
const signAccessToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const signRefreshToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

const sendTokens = (res, payload) => {
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
    });
    return accessToken;
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res) => {
    // 1. Revisar errores de validacion
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400);
        throw new Error(errors.array()[0].msg);
    }

    const email = sanitizeEmail(req.body.email);
    const { password } = req.body;
    const name = (req.body.name || '').trim();
    const dui = (req.body.dui || '').trim();

    const namePattern = /^[a-zA-Z0-9 .,'-]{2,80}$/;
    if (!name || !namePattern.test(name)) {
        res.status(400);
        throw new Error('Nombre inválido. Usa solo letras, números y signos simples.');
    }

    const duiPattern = /^\d{8}-\d$/; // Formato salvadoreño clásico 00000000-0
    if (!dui || !duiPattern.test(dui)) {
        res.status(400);
        throw new Error('DUI inválido. Formato esperado: 00000000-0');
    }

    // 2. Verificar duplicados
    let user = await User.findOne({ email });
    if (user) {
        res.status(400);
        throw new Error('User already exists');
    }

    const existingDui = await User.findOne({ dui });
    if (existingDui) {
        res.status(400);
        throw new Error('DUI ya registrado');
    }

    // 3. Crear Usuario
    user = new User({
        email,
        password,
        name,
        dui
    });

    // 4. Encriptar Password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    await user.save(); // Guarda el usuario en la base de datos de mongodb atlas. 

    // 5. Generar Token
    const payload = { user: { id: user.id, role: user.role } };
    const accessToken = sendTokens(res, payload);
    res.json({ token: accessToken });
});

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res) => {
    // 1. Revisar errores de validacion
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400);
        throw new Error(errors.array()[0].msg);
    }

    const email = sanitizeEmail(req.body.email);
    const { password } = req.body;

    // 2. Buscar usuario
    let user = await User.findOne({ email });
    if (!user) {
        res.status(400);
        throw new Error('Invalid Credentials');
    }

    // 3. Verificar password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        res.status(400);
        throw new Error('Invalid Credentials');
    }

    // 4. Generar Token
    const payload = { user: { id: user.id, role: user.role } };
    const accessToken = sendTokens(res, payload);
    res.json({ token: accessToken });
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.me = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
        res.status(404);
        throw new Error('User not found');
    }
    res.json(user);
});

// @desc    Logout (stateless JWT: el cliente borra el token)
// @route   POST /api/auth/logout
// @access  Private
exports.logout = asyncHandler(async (req, res) => {
    res.clearCookie('refreshToken');
    res.json({ msg: 'Logged out. Token invalidated on client and refresh cleared.' });
});

// @desc    Forgot password (genera token)
// @route   POST /api/auth/forgot
// @access  Public (respuesta genérica)
exports.forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const normalizedEmail = sanitizeEmail(email || '');
    const user = await User.findOne({ email: normalizedEmail });

    // Respuesta genérica siempre
    const genericResponse = { msg: 'Si el correo existe, se enviaron instrucciones' };

    if (!user) {
        return res.json(genericResponse);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    await PasswordReset.deleteMany({ user: user._id });
    await PasswordReset.create({ user: user._id, tokenHash, expiresAt });

    // TODO: Enviar email con el token real al usuario (no exponerlo en la respuesta).
    // Ejemplo: emailService.sendReset(email, token);
    // En prod devolvemos solo respuesta genérica.
    res.json(genericResponse);
});

// @desc    Reset password con token
// @route   POST /api/auth/reset
// @access  Public
exports.resetPassword = asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const passwordStrong = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!token || !password || !passwordStrong.test(password)) {
        res.status(400);
        throw new Error('Token inválido o password no cumple requisitos');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await PasswordReset.findOne({
        tokenHash,
        expiresAt: { $gt: new Date() }
    });

    if (!reset) {
        res.status(400);
        throw new Error('Token inválido o expirado');
    }

    const user = await User.findById(reset.user);
    if (!user) {
        res.status(400);
        throw new Error('Usuario no encontrado');
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    await PasswordReset.deleteMany({ user: user._id });

    res.clearCookie('refreshToken');
    res.json({ msg: 'Password actualizada. Vuelve a iniciar sesión.' });
});

// @desc    Refrescar access token usando refresh cookie
// @route   POST /api/auth/refresh
// @access  Public (usa refresh cookie HttpOnly)
exports.refresh = asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token) {
        res.status(401);
        throw new Error('No refresh token');
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const payload = { user: { id: decoded.user.id, role: decoded.user.role } };
        const accessToken = signAccessToken(payload);
        res.json({ token: accessToken });
    } catch (err) {
        res.status(401);
        throw new Error('Refresh token inválido o expirado');
    }
});
