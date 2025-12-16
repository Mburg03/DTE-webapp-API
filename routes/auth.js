const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

// Validacion para el registro
router.post('/register',
    [
        check('email', 'Por favor incluye un email válido').isEmail(), 
        check('password', 'El password debe tener 8 o más caracteres').isLength({ min: 8 }),
        check('name', 'El nombre es obligatorio').not().isEmpty(),
        check('dui', 'El DUI es obligatorio').not().isEmpty()

    ],
    authController.register
);
router.post(
    '/login',
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
