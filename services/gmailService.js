const { google } = require('googleapis');
const { createOAuthClient } = require('../config/gmail');
const { decrypt } = require('../utils/encryption');

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const getAuthUrl = (state) => {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // necesitamos refresh_token
        prompt: 'consent', // fuerza entregar refresh_token aunque ya haya consentimiento previo
        scope: GMAIL_SCOPES,
        include_granted_scopes: true,
        state
    });
};

const exchangeCodeForTokens = async (code) => {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens; // { access_token, refresh_token, expiry_date, scope, token_type }
};

const refreshAccessToken = async (encryptedRefreshToken) => {
    let refreshToken;
    try {
        refreshToken = decrypt(encryptedRefreshToken);
    } catch (err) {
        const error = new Error('Unable to decrypt refresh token. Check ENCRYPTION_KEY.');
        error.code = 'DECRYPT_FAILED';
        throw error;
    }

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    try {
        const { token } = await oauth2Client.getAccessToken(); // googleapis returns { token, res }
        return { access_token: token };
    } catch (err) {
        const detail = err?.response?.data?.error_description || err.message;
        const error = new Error(`Unable to refresh access token: ${detail}`);
        error.code = 'REFRESH_FAILED';
        throw error;
    }
};

const getUserProfile = async (accessToken) => {
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    return profile.data;
};

// --- Nuevas funciones de búsqueda y descarga ---
const getGmailClient = (accessToken) => {
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.gmail({ version: 'v1', auth: oauth2Client });
};

const listMessages = async (accessToken, query, maxMessages = 100) => {
    const gmail = getGmailClient(accessToken);
    let messages = [];
    let nextPageToken = null;

    do {
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            pageToken: nextPageToken,
            maxResults: 70 // Paginar de 70 en 70 (valor anterior)
        });

        if (res.data.messages) {
            messages = messages.concat(res.data.messages);
        }
        nextPageToken = res.data.nextPageToken;
    } while (nextPageToken && messages.length < maxMessages); // corto en maxMessages

    return messages.slice(0, maxMessages);
};

const getMessageDetails = async (gmail, messageId) => {
    const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId
    });
    return res.data;
};

const getAttachment = async (gmail, messageId, attachmentId) => {
    const res = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: messageId,
        id: attachmentId
    });
    return res.data.data; // Base64URL string
};

const fs = require('fs');
const path = require('path');
const { baseKeywords } = require('../config/searchConfig');

// Extrae partes de manera recursiva (algunos mensajes anidan adjuntos)
const collectParts = (payload, acc = []) => {
    if (!payload) return acc;
    if (payload.parts) {
        payload.parts.forEach((p) => collectParts(p, acc));
    } else {
        acc.push(payload);
    }
    return acc;
};

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const processInvoices = async ({
    accessToken,
    startEpoch,
    endEpoch,
    userId,
    batchLabel,
    maxMessages = 100,
    customKeywords = []
}) => {
    // 1. Construir query
    const allKeywords = [...new Set([...baseKeywords, ...customKeywords])];
    const subjectQuery = `subject:(${allKeywords.map((k) => `"${k}"`).join(' OR ')})`;
    const dateQuery = `after:${startEpoch} before:${endEpoch}`;
    const query = `${subjectQuery} has:attachment ${dateQuery}`;

    const gmail = getGmailClient(accessToken);
    const messages = await listMessages(accessToken, query, maxMessages);

    const baseDir = path.join(__dirname, '../uploads/zips', String(userId), batchLabel);
    const correosDir = path.join(baseDir, 'JSON_y_PDFS');
    const soloPdfDir = path.join(baseDir, 'SOLO_PDF');

    ensureDir(correosDir);
    ensureDir(soloPdfDir);

    let processed = 0;
    const savedFiles = [];
    let pdfCount = 0;
    let jsonCount = 0;
    const attachmentSeen = new Set();

    // Ejecuta tareas con concurrencia limitada (pool). Aquí se usa para descargar adjuntos más rápido.
    const runWithPool = async (tasks, limit = 8) => {
        const results = [];
        let i = 0;
        const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
            while (i < tasks.length) {
                const idx = i++;
                results[idx] = await tasks[idx]();
            }
        });
        await Promise.all(workers);
        return results;
    };

    const messageTasks = messages.map((msg) => async () => {
        try {
            const filenameSeen = new Set(); // para dedupe de PDFs por nombre dentro del mismo correo
            const fullMsg = await getMessageDetails(gmail, msg.id);
            const headers = fullMsg.payload.headers || [];
            const subject = headers.find((h) => h.name === 'Subject')?.value || 'No Subject';
            const safeSubject = subject.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            const emailFolder = path.join(correosDir, `${safeSubject}_${msg.id}`);

            const parts = collectParts(fullMsg.payload, []);
            let hasRelevant = false;

            const tasks = [];

            for (const part of parts) {
                if (!part.filename || !part.body || !part.body.attachmentId) continue;
                const ext = path.extname(part.filename).toLowerCase();
                if (ext !== '.pdf' && ext !== '.json') continue;

                const attKey = `${msg.id}:${part.body.attachmentId}`;
                if (attachmentSeen.has(attKey)) continue; // evitar duplicados globales

                // Evitar PDFs con mismo nombre en el mismo correo
                if (ext === '.pdf' && filenameSeen.has(part.filename)) {
                    continue;
                }

                tasks.push(async () => {
                    attachmentSeen.add(attKey);
                    if (ext === '.pdf') filenameSeen.add(part.filename);

                    const attachmentData = await getAttachment(gmail, msg.id, part.body.attachmentId);
                    const buffer = Buffer.from(attachmentData, 'base64');

                    if (!hasRelevant) {
                        ensureDir(emailFolder);
                        hasRelevant = true;
                    }

                    // Guarda en carpeta por correo
                    fs.writeFileSync(path.join(emailFolder, part.filename), buffer);

                    // Duplica PDFs en carpeta plana
                    if (ext === '.pdf') {
                        fs.writeFileSync(path.join(soloPdfDir, `${safeSubject}_${msg.id}_${part.filename}`), buffer);
                        pdfCount++;
                    }

                    if (ext === '.json') {
                        jsonCount++;
                    }

                    savedFiles.push(part.filename);
                });
            }

            // Ejecutar descargas con concurrencia limitada por correo
            if (tasks.length) {
                await runWithPool(tasks, 8);
            }

            if (hasRelevant) {
                processed++;
            }
        } catch (err) {
            console.error(`Error processing message ${msg.id}:`, err.message);
            // Continuamos con el siguiente mensaje
        }
    });

    // Procesar correos en paralelo con un pool para mejorar tiempos
    await runWithPool(messageTasks, 4);

    return {
        processed,
        messagesFound: messages.length,
        filesSaved: savedFiles.length,
        pdfCount,
        jsonCount,
        outputDir: baseDir
    };
};

module.exports = {
    getAuthUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    getUserProfile,
    getGmailClient,
    listMessages,
    getAttachment,
    processInvoices
};
