const mongoose = require('mongoose');

const GmailConnectionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true
        },
        email: {
            type: String,
            required: true
        },
        refreshToken: {
            type: String,
            required: true
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('GmailConnection', GmailConnectionSchema);
