const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Package = require('../models/Package');

// @desc Lista de usuarios con stats de paquetes
// @route GET /api/admin/users
// @access Admin
exports.listUsers = asyncHandler(async (req, res) => {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const reqLimit = parseInt(req.query.limit || '10', 10);
    const limit = Math.min(Math.max(reqLimit, 1), 50);
    const skip = (page - 1) * limit;

    const pipeline = [
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
            $lookup: {
                from: 'packages',
                let: { uid: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$user', '$$uid'] } } },
                    {
                        $group: {
                            _id: null,
                            totalPackages: { $sum: 1 },
                            totalFiles: { $sum: '$filesSaved' },
                            totalPdf: { $sum: '$pdfCount' },
                            totalJson: { $sum: '$jsonCount' },
                            totalSize: { $sum: '$sizeBytes' }
                        }
                    }
                ],
                as: 'stats'
            }
        },
        {
            $addFields: {
                stats: { $ifNull: [{ $arrayElemAt: ['$stats', 0] }, {}] }
            }
        },
        {
            $project: {
                password: 0
            }
        }
    ];

    const [items, total] = await Promise.all([
        User.aggregate(pipeline),
        User.countDocuments()
    ]);

    res.json({ page, limit, total, items });
});

// @desc Detalle de usuario con paquetes
// @route GET /api/admin/users/:id
// @access Admin
exports.getUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    const packages = await Package.find({ user: user._id }).sort({ createdAt: -1 }).lean();
    res.json({ user, packages });
});

// @desc Reset de password de usuario (admin)
// @route PATCH /api/admin/users/:id/password
// @access Admin
exports.resetPassword = asyncHandler(async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 8) {
        res.status(400);
        throw new Error('Password muy corta');
    }
    const user = await User.findById(req.params.id);
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();
    res.json({ msg: 'Password actualizada' });
});

// @desc Actualizar rol de usuario
// @route PATCH /api/admin/users/:id/role
// @access Admin
exports.updateRole = asyncHandler(async (req, res) => {
    const { role } = req.body;
    const allowed = ['viewer', 'basic', 'admin'];
    if (!allowed.includes(role)) {
        res.status(400);
        throw new Error('Rol inválido');
    }
    const user = await User.findById(req.params.id);
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    user.role = role;
    await user.save();
    res.json({ msg: 'Rol actualizado', role: user.role });
});

// @desc Eliminar usuario (y sus paquetes)
// @route DELETE /api/admin/users/:id
// @access Admin
exports.deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    await Package.deleteMany({ user: user._id });
    await user.deleteOne();
    res.json({ msg: 'Usuario eliminado' });
});
