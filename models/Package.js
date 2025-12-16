const mongoose = require('mongoose');

const PackageSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        batchLabel: {
            type: String,
            required: true
        },
        zipPath: {
            type: String
        },
        storageKey: {
            type: String,
            required: true
        },
        storageProvider: {
            type: String,
            default: 'aws'
        },
        status: {
            type: String,
            enum: ['available', 'expired'],
            default: 'available'
        },
        sizeBytes: {
            type: Number,
            default: 0
        },
        filesSaved: {
            type: Number,
            default: 0
        },
        messagesFound: {
            type: Number,
            default: 0
        },
        pdfCount: {
            type: Number,
            default: 0
        },
        jsonCount: {
            type: Number,
            default: 0
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Package', PackageSchema);
