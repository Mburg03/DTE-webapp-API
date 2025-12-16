const { S3Client } = require('@aws-sdk/client-s3');

const requiredS3 = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET'];

const validateS3Env = () => {
    requiredS3.forEach((key) => {
        if (!process.env[key]) {
            throw new Error(`Missing required S3 env var: ${key}`);
        }
    });
};

const createS3Client = () => {
    validateS3Env();
    return new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });
};

module.exports = { createS3Client, validateS3Env };
