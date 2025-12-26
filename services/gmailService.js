const { google } = require('googleapis');
const { createOAuthClient } = require('../config/gmail');
const { decrypt } = require('../utils/encryption');
const axios = require('axios');
const crypto = require('crypto');

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

const listMessages = async (accessToken, query, maxMessages = 100, includeSpam = false) => {
    const gmail = getGmailClient(accessToken);
    let messages = [];
    let nextPageToken = null;

    do {
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            includeSpamTrash: includeSpam,
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

// Hosts permitidos para descargas vía link (caso Walmart/Edicom)
const allowedLinkHosts = ['s.edicom.eu', 'edicomgroup.com', 'edicom.net'];

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

const decodeBase64Url = (data) => {
    const buff = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return buff.toString('utf8');
};

const extractLinksFromPayload = (payload) => {
    const links = [];
    const parts = collectParts(payload, []);
    for (const part of parts) {
        const mime = part.mimeType || '';
        const body = part.body?.data;
        if (!body) continue;
        if (mime.includes('text/plain') || mime.includes('text/html')) {
            try {
                const text = decodeBase64Url(body);
                const found = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
                links.push(...found);
            } catch (err) {
                // ignoramos errores de decode
            }
        }
    }
    return links;
};

const sanitizeFilename = (name) => {
    const raw = path.basename(name || 'archivo.pdf');
    return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
};

const hashBuffer = (buffer) => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

const isAllowedLink = (urlStr) => {
    try {
        const u = new URL(urlStr);
        return allowedLinkHosts.includes(u.hostname.toLowerCase());
    } catch {
        return false;
    }
};

const downloadPdfFromLink = async (url) => {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
    const contentType = res.headers['content-type'] || '';
    if (!contentType.includes('pdf') && !url.toLowerCase().endsWith('.pdf')) {
        const err = new Error('Link is not a PDF');
        err.code = 'NOT_PDF';
        throw err;
    }
    return Buffer.from(res.data);
};

const processInvoices = async ({
    accessToken,
    startEpoch,
    endEpoch,
    userId,
    batchLabel,
    maxMessages = 100,
    customKeywords = [],
    maxDtes = Infinity,
    includeSpam = false
}) => {
    // 1. Construir query
    const allKeywords = [...new Set([...baseKeywords, ...customKeywords])];
    const subjectQuery = `subject:(${allKeywords.map((k) => `"${k}"`).join(' OR ')})`;
    const dateQuery = `after:${startEpoch} before:${endEpoch}`;
    const query = `${subjectQuery} has:attachment ${dateQuery}`;

    const gmail = getGmailClient(accessToken);
    const messages = await listMessages(accessToken, query, maxMessages, includeSpam);

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
    const linkSeen = new Set();
    const hashSeen = new Set(); // dedupe global por contenido

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
                if (maxDtes !== Infinity && jsonCount >= maxDtes) {
                    continue; // límite alcanzado
                }
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
                    if (maxDtes !== Infinity && jsonCount >= maxDtes && ext === '.json') {
                        return;
                    }
                    attachmentSeen.add(attKey);
                    if (ext === '.pdf') filenameSeen.add(part.filename);

                    const attachmentData = await getAttachment(gmail, msg.id, part.body.attachmentId);
                    const buffer = Buffer.from(attachmentData, 'base64');

                    // Dedupe por hash global
                    const hash = hashBuffer(buffer);
                    if (hashSeen.has(hash)) {
                        return;
                    }
                    hashSeen.add(hash);

                    if (!hasRelevant) {
                        ensureDir(emailFolder);
                        hasRelevant = true;
                    }

                    // Guarda en carpeta por correo con nombre sanitizado
                    const safeFilename = sanitizeFilename(part.filename);
                    fs.writeFileSync(path.join(emailFolder, safeFilename), buffer);

                    // Duplica PDFs en carpeta plana
                    if (ext === '.pdf') {
                        fs.writeFileSync(path.join(soloPdfDir, `${safeSubject}_${msg.id}_${safeFilename}`), buffer);
                        pdfCount++;
                    }

                    if (ext === '.json') {
                        if (maxDtes !== Infinity && jsonCount >= maxDtes) {
                            return;
                        }
                        jsonCount++;
                    }

                    savedFiles.push(safeFilename);
                });
            }

            // Ejecutar descargas con concurrencia limitada por correo
            if (tasks.length) {
                await runWithPool(tasks, 8);
            }

            // Descargar PDFs desde links del cuerpo (para correos sin adjunto, ej. Walmart/Edicom)
            const links = extractLinksFromPayload(fullMsg.payload).filter((l) => isAllowedLink(l));
            const linkTasks = links
                .filter((l) => !linkSeen.has(l))
                .map((link) => async () => {
                    try {
                        if (maxDtes !== Infinity && jsonCount >= maxDtes) return;
                        linkSeen.add(link);
                        const buffer = await downloadPdfFromLink(link);
                        const hash = hashBuffer(buffer);
                        if (hashSeen.has(hash)) return;
                        hashSeen.add(hash);
                        if (!hasRelevant) {
                            ensureDir(emailFolder);
                            hasRelevant = true;
                        }
                        const filenameFromUrl = sanitizeFilename(link.split('/').pop() || 'factura.pdf');
                        const safeFilename = filenameFromUrl.toLowerCase().endsWith('.pdf')
                            ? filenameFromUrl
                            : `${filenameFromUrl}.pdf`;
                        fs.writeFileSync(path.join(emailFolder, safeFilename), buffer);
                        fs.writeFileSync(path.join(soloPdfDir, `${safeSubject}_${msg.id}_${safeFilename}`), buffer);
                        pdfCount++;
                        savedFiles.push(safeFilename);
                    } catch (err) {
                        // ignorar errores de descarga o tipo no PDF
                    }
                });

            if (linkTasks.length) {
                await runWithPool(linkTasks, 4);
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
