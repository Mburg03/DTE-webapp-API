const mongoose = require('mongoose');

const ReplaceIntentSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        targetAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'GmailConnection', required: true },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

ReplaceIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ReplaceIntent', ReplaceIntentSchema);
