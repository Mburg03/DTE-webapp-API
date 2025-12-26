const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const packagesController = require('../controllers/packagesController');

router.post('/generate', auth, requireRole(['basic', 'admin']), packagesController.generate);
router.get('/download/:id', auth, requireRole(['basic', 'admin']), packagesController.download);
router.get('/', auth, requireRole(['basic', 'admin']), packagesController.list);
router.get('/latest', auth, requireRole(['basic', 'admin']), packagesController.latest);
router.get('/usage', auth, requireRole(['basic', 'admin']), packagesController.usage);

module.exports = router;
