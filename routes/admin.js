const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const adminController = require('../controllers/adminController');

router.get('/users', auth, isAdmin, adminController.listUsers);
router.get('/users/:id', auth, isAdmin, adminController.getUser);
router.patch('/users/:id/password', auth, isAdmin, adminController.resetPassword);
router.patch('/users/:id/role', auth, isAdmin, adminController.updateRole);
router.delete('/users/:id', auth, isAdmin, adminController.deleteUser);

module.exports = router;
