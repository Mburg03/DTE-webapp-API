const mongoose = require('mongoose');

const GmailConnectionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        email: {
            type: String,
            required: true
        },
        refreshToken: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: ['active', 'disabled'],
            default: 'active'
        },
        primary: {
            type: Boolean,
            default: false
        },
        lastUsedAt: {
            type: Date
        },
        disabledAt: {
            type: Date
        }
    },
    { timestamps: true }
);

GmailConnectionSchema.index({ user: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('GmailConnection', GmailConnectionSchema);
