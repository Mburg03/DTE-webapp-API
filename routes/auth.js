const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

// Limitadores específicos para evitar abuso en auth
const loginLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 7,
    message: 'Demasiados intentos de login. Intenta de nuevo en un minuto.'
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20,
    message: 'Demasiados registros desde esta IP. Intenta más tarde.'
});

// Validacion para el registro
router.post('/register',
    registerLimiter,
    [
        check('email', 'Por favor incluye un email válido').isEmail(), 
        check('password', 'El password debe tener mínimo 8 caracteres, una mayúscula, un número y un símbolo')
            .isLength({ min: 8 })
            .matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/),
        check('name', 'El nombre es obligatorio').not().isEmpty(),
        check('dui', 'El DUI es obligatorio').not().isEmpty()

    ],
    authController.register
);
router.post(
    '/login',
    loginLimiter,
    [
        check('email', 'Por favor incluye un email válido').isEmail(),
        check('password', 'El password debe tener 8 o más caracteres').isLength({ min: 8 })
    ],
    authController.login
);

router.get('/me', auth, authController.me);
router.post('/logout', auth, authController.logout);
router.post('/forgot', authController.forgotPassword);
router.post('/reset', authController.resetPassword);

module.exports = router;
