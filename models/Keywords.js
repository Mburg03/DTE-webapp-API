const mongoose = require('mongoose');

const KeywordsSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true
        },
        base: {
            type: [String],
            default: []
        },
        custom: {
            type: [String],
            default: []
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Keywords', KeywordsSchema);
