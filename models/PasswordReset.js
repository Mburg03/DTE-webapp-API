const mongoose = require('mongoose');

const PasswordResetSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        tokenHash: { type: String, required: true },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordReset', PasswordResetSchema);
