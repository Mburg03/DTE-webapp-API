const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const keywordsController = require('../controllers/keywordsController');

router.get('/', auth, requireRole(['basic', 'admin']), keywordsController.getKeywords);
router.post('/', auth, requireRole(['basic', 'admin']), keywordsController.addKeyword);
router.delete('/:keyword', auth, requireRole(['basic', 'admin']), keywordsController.deleteKeyword);

module.exports = router;
