const { google } = require('googleapis');

// Permite configurar timeout para llamadas a Google (ms). Default 45s.
const apiTimeout = process.env.GOOGLE_API_TIMEOUT_MS
    ? parseInt(process.env.GOOGLE_API_TIMEOUT_MS, 10)
    : 45000;
google.options({ timeout: apiTimeout });

const requiredEnv = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];

const validateEnv = () => {
    requiredEnv.forEach((key) => {
        if (!process.env[key]) {
            throw new Error(`Missing required Gmail env var: ${key}`);
        }
    });
};

const createOAuthClient = () => {
    validateEnv();
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
};

module.exports = { createOAuthClient };
