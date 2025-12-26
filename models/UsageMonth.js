const mongoose = require('mongoose');

const UsageMonthSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        period: { type: String, required: true }, // formato YYYY-MM
        dteCount: { type: Number, default: 0 }
    },
    { timestamps: true }
);

UsageMonthSchema.index({ user: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('UsageMonth', UsageMonthSchema);
