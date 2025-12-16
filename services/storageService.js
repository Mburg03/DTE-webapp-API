const { PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const { createS3Client } = require('../config/s3');

const s3 = createS3Client();
const bucket = process.env.S3_BUCKET;

const uploadZip = async (localPath, storageKey) => {
    const fileStream = fs.createReadStream(localPath);
    const contentType = 'application/zip';
    await s3.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: storageKey,
            Body: fileStream,
            ContentType: contentType
        })
    );
};

const getDownloadUrl = async (storageKey, expiresInSeconds = 300, filename) => {
    // Verificar existencia primero (Head), luego firmar GetObject
    try {
        await s3.send(
            new HeadObjectCommand({
                Bucket: bucket,
                Key: storageKey
            })
        );
    } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404) {
            const error = new Error('File not found in storage');
            error.code = 'STORAGE_NOT_FOUND';
            throw error;
        }
        throw err;
    }

    return getSignedUrl(
        s3,
        new GetObjectCommand({
            Bucket: bucket,
            Key: storageKey,
            ...(filename
                ? {
                      ResponseContentDisposition: `attachment; filename="${filename}"`
                  }
                : {})
        }),
        { expiresIn: expiresInSeconds }
    );
};

module.exports = {
    uploadZip,
    getDownloadUrl
};
