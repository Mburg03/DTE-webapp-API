const crypto = require('crypto');

// Simple AES-256-GCM helpers to guardar tokens sensibles encriptados en DB.
const getKey = () => {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be 32 characters long');
    }
    return Buffer.from(key);
};

const encrypt = (text) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
};

const decrypt = (enc) => {
    const [ivB64, dataB64, tagB64] = enc.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const encryptedText = Buffer.from(dataB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
};

module.exports = { encrypt, decrypt };
