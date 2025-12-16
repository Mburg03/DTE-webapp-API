const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const zipDirectory = async (sourceDir, outPath) => {
    return new Promise((resolve, reject) => {
        ensureDir(path.dirname(outPath));
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve({ size: archive.pointer() }));
        archive.on('error', (err) => reject(err));

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
};

const cleanOldZips = (baseDir, maxAgeHours = 24) => {
    if (!fs.existsSync(baseDir)) return;
    const threshold = Date.now() - maxAgeHours * 60 * 60 * 1000;
    fs.readdirSync(baseDir).forEach((userId) => {
        const userPath = path.join(baseDir, userId);
        if (!fs.lstatSync(userPath).isDirectory()) return;
        fs.readdirSync(userPath).forEach((batch) => {
            const batchPath = path.join(userPath, batch);
            const stats = fs.statSync(batchPath);
            if (stats.mtimeMs < threshold) {
                fs.rmSync(batchPath, { recursive: true, force: true });
            }
        });
    });
};

module.exports = {
    zipDirectory,
    cleanOldZips
};
