const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const gmailController = require('../controllers/gmailController');

// Iniciar flujo OAuth (devuelve URL de Google)
router.get('/auth', auth, requireRole(['basic', 'admin']), gmailController.startAuth);

// Callback de Google (usa state para identificar al usuario)
router.get('/callback', gmailController.handleCallback);

// Reemplazo de cuenta (inicia OAuth con intent)
router.post('/replace', auth, requireRole(['basic', 'admin']), gmailController.startReplace);

// Estado/listado de cuentas conectadas
router.get('/status', auth, requireRole(['basic', 'admin']), gmailController.status);

// Desconectar
router.delete('/:id', auth, requireRole(['basic', 'admin']), gmailController.disconnect);
// Activar cuenta como primaria
router.patch('/:id/activate', auth, requireRole(['basic', 'admin']), gmailController.activate);

module.exports = router;
