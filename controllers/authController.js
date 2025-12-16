const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const PasswordReset = require('../models/PasswordReset');

const sanitizeEmail = (email = '') => email.trim().toLowerCase();

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
    const { password, name, dui } = req.body;

    if (!dui || !dui.trim()) {
        res.status(400);
        throw new Error('DUI es obligatorio');
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
    
    // Usamos version sincrona para asegurar que asyncHandler capture errores
    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '5d' }
    );

    res.json({ token });
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
    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '5d' }
    );

    res.json({ token });
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
    // Con JWT sin estado, "logout" se maneja en el cliente borrando el token.
    // Devolvemos mensaje para que el frontend lo sepa.
    res.json({ msg: 'Logged out. Please delete token on client.' });
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

    // En un sistema real enviaríamos email; para desarrollo devolvemos el token
    res.json({ ...genericResponse, resetToken: token });
});

// @desc    Reset password con token
// @route   POST /api/auth/reset
// @access  Public
exports.resetPassword = asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
        res.status(400);
        throw new Error('Token inválido o password muy corta');
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

    res.json({ msg: 'Password actualizada' });
});
