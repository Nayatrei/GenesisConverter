const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const PORT = Number.parseInt(process.env.PORT || '4173', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
const TRANSFER_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_UPLOADS = 30;
const TRANSFER_DIR = path.join(os.tmpdir(), 'genesis-bambu-transfers');
const RELEASE_VERSION_PATTERN = /^(?:r-[a-f0-9]{16}|\d{8}[a-z])$/;
const APP_RELEASE_VERSION = (() => {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'app-version.json'), 'utf8'));
        return typeof manifest?.version === 'string' ? manifest.version : '';
    } catch {
        return '';
    }
})();
const transfers = new Map();
const TAB_ROUTE_FILES = new Map([
    ['/3d-obj', '/3d-obj.html'],
    ['/logo', '/logo.html'],
    ['/raster', '/raster.html'],
    ['/annotate', '/annotate.html'],
    ['/bulk', '/bulk.html'],
    ['/pdf', '/pdf.html'],
    ['/svg', '/svg.html']
]);
const uploadHistoryByIp = new Map();

const MIME_TYPES = {
    '.avif': 'image/avif',
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp'
};

function sendJson(response, statusCode, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    response.writeHead(statusCode, {
        'Cache-Control': 'no-store',
        'Content-Length': body.length,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(body);
}

function sanitizeTransferFilename(value) {
    const decoded = String(value || 'genesis-model.3mf').normalize('NFKC');
    const basename = path.basename(decoded).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const withoutExtension = basename.replace(/\.3mf$/i, '') || 'genesis-model';
    const safeStem = withoutExtension
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 96)
        .trim() || 'genesis-model';
    return `${safeStem}.3mf`;
}

function getClientIp(request) {
    const forwarded = String(request.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    return forwarded || request.socket.remoteAddress || 'unknown';
}

function isUploadRateLimited(request) {
    const clientIp = getClientIp(request);
    const now = Date.now();
    const recentUploads = (uploadHistoryByIp.get(clientIp) || [])
        .filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (recentUploads.length >= RATE_LIMIT_MAX_UPLOADS) {
        uploadHistoryByIp.set(clientIp, recentUploads);
        return true;
    }
    recentUploads.push(now);
    uploadHistoryByIp.set(clientIp, recentUploads);
    return false;
}

function getPublicOrigin(request) {
    const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim();
    const protocol = forwardedProtocol || (request.socket.encrypted ? 'https' : 'http');
    const forwardedHost = String(request.headers['x-forwarded-host'] || '')
        .split(',')[0]
        .trim();
    const host = forwardedHost || request.headers.host;
    return `${protocol}://${host}`;
}

function collectRequestBody(request, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let settled = false;

        request.on('data', (chunk) => {
            if (settled) return;
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                settled = true;
                chunks.length = 0;
                const error = new Error('Transfer exceeds the 64 MB limit.');
                error.statusCode = 413;
                reject(error);
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks));
        });
        request.on('error', (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        });
    });
}

function is3mfArchive(buffer) {
    const hasZipSignature = buffer.length >= 4
        && buffer[0] === 0x50
        && buffer[1] === 0x4b
        && buffer[2] === 0x03
        && buffer[3] === 0x04;
    if (!hasZipSignature) return false;

    return buffer.includes(Buffer.from('[Content_Types].xml'))
        && buffer.includes(Buffer.from('3D/3dmodel.model'));
}

async function removeTransfer(token) {
    const transfer = transfers.get(token);
    transfers.delete(token);
    if (!transfer) return;
    await fs.promises.unlink(transfer.filePath).catch(() => {});
}

async function cleanupExpiredTransfers() {
    const now = Date.now();
    await Promise.all(
        [...transfers.entries()]
            .filter(([, transfer]) => transfer.expiresAt <= now)
            .map(([token]) => removeTransfer(token))
    );

    uploadHistoryByIp.forEach((timestamps, clientIp) => {
        const active = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
        if (active.length) uploadHistoryByIp.set(clientIp, active);
        else uploadHistoryByIp.delete(clientIp);
    });
}

async function handleTransferUpload(request, response, requestUrl) {
    if (isUploadRateLimited(request)) {
        sendJson(response, 429, { error: 'Too many transfer requests. Please try again shortly.' });
        return;
    }

    const contentLength = Number.parseInt(request.headers['content-length'] || '0', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_TRANSFER_BYTES) {
        sendJson(response, 413, { error: 'Transfer exceeds the 64 MB limit.' });
        return;
    }

    try {
        const body = await collectRequestBody(request, MAX_TRANSFER_BYTES);
        if (!is3mfArchive(body)) {
            sendJson(response, 415, { error: 'Only valid 3MF project files can be transferred.' });
            return;
        }

        const token = crypto.randomBytes(24).toString('hex');
        const filename = sanitizeTransferFilename(requestUrl.searchParams.get('filename'));
        const filePath = path.join(TRANSFER_DIR, `${token}.3mf`);
        const expiresAt = Date.now() + TRANSFER_TTL_MS;

        await fs.promises.mkdir(TRANSFER_DIR, { recursive: true });
        await fs.promises.writeFile(filePath, body, { flag: 'wx', mode: 0o600 });
        transfers.set(token, {
            expiresAt,
            filePath,
            filename,
            size: body.length
        });

        const publicUrl = new URL(
            `/api/bambu-transfer/${token}/${encodeURIComponent(filename)}`,
            getPublicOrigin(request)
        ).toString();

        sendJson(response, 201, {
            expiresAt: new Date(expiresAt).toISOString(),
            filename,
            size: body.length,
            url: publicUrl
        });
    } catch (error) {
        if (!response.headersSent) {
            sendJson(response, error.statusCode || 500, {
                error: error.message || 'Could not prepare the Bambu Studio transfer.'
            });
        }
    }
}

async function handleTransferDownload(request, response, token) {
    const transfer = transfers.get(token);
    if (!transfer) {
        sendJson(response, 404, { error: 'Transfer not found or already expired.' });
        return;
    }
    if (transfer.expiresAt <= Date.now()) {
        await removeTransfer(token);
        sendJson(response, 410, { error: 'Transfer expired. Send the model again.' });
        return;
    }

    try {
        const stats = await fs.promises.stat(transfer.filePath);
        const asciiFilename = transfer.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
        response.writeHead(200, {
            'Cache-Control': `private, max-age=${Math.floor(TRANSFER_TTL_MS / 1000)}`,
            'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(transfer.filename)}`,
            'Content-Length': stats.size,
            'Content-Type': 'model/3mf',
            'X-Content-Type-Options': 'nosniff'
        });
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        fs.createReadStream(transfer.filePath)
            .on('error', () => {
                if (!response.headersSent) sendJson(response, 500, { error: 'Could not read transfer.' });
                else response.destroy();
            })
            .pipe(response);
    } catch {
        await removeTransfer(token);
        sendJson(response, 404, { error: 'Transfer file is no longer available.' });
    }
}

function resolveStaticFile(pathname) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    if (decodedPath.includes('\0')) return null;

    const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const resolvedPath = path.resolve(ROOT_DIR, relativePath);
    if (resolvedPath !== ROOT_DIR && !resolvedPath.startsWith(`${ROOT_DIR}${path.sep}`)) return null;
    return resolvedPath;
}

async function serveStaticFile(request, response, pathname) {
    const routedPathname = TAB_ROUTE_FILES.get(pathname) || pathname;
    const filePath = resolveStaticFile(routedPathname);
    if (!filePath) {
        response.writeHead(400);
        response.end('Bad request');
        return;
    }

    try {
        const stats = await fs.promises.stat(filePath);
        const finalPath = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
        const finalStats = stats.isDirectory() ? await fs.promises.stat(finalPath) : stats;
        const extension = path.extname(finalPath).toLowerCase();
        const isMutableAsset = ['.html', '.css', '.js', '.mjs'].includes(extension);
        const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const isToolShell = extension === '.html' && path.dirname(finalPath) === ROOT_DIR;
        const isBootstrapAsset = isToolShell
            || requestUrl.pathname === '/app-bootstrap.js'
            || requestUrl.pathname === '/app-version.json';
        const requestedVersion = requestUrl.searchParams.get('v') || '';
        const isReleaseVersionedAsset = isMutableAsset && requestedVersion === APP_RELEASE_VERSION;
        const isStaleReleaseRequest = isMutableAsset
            && RELEASE_VERSION_PATTERN.test(requestedVersion)
            && requestedVersion !== APP_RELEASE_VERSION;

        // Never put current bytes behind an old or guessed release URL. That
        // would permanently poison an immutable CDN cache with a mixed graph.
        if (isStaleReleaseRequest) {
            response.writeHead(409, {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/plain; charset=utf-8',
                'X-Content-Type-Options': 'nosniff'
            });
            response.end('Release version mismatch. Refresh to load the current app.');
            return;
        }
        const cacheControl = isBootstrapAsset
            ? 'no-store'
            : isReleaseVersionedAsset
                ? 'public, max-age=31536000, immutable'
                : 'no-cache';

        response.writeHead(200, {
            'Cache-Control': cacheControl,
            'Content-Length': finalStats.size,
            'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
        });
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        fs.createReadStream(finalPath).pipe(response);
    } catch {
        response.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end('Not found');
    }
}

async function requestHandler(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (requestUrl.pathname === '/api/bambu-transfer' && request.method === 'POST') {
        await handleTransferUpload(request, response, requestUrl);
        return;
    }

    const transferMatch = requestUrl.pathname.match(
        /^\/api\/bambu-transfer\/([a-f0-9]{48})\/[^/]+\.3mf$/i
    );
    if (transferMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        await handleTransferDownload(request, response, transferMatch[1]);
        return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD, POST' });
        response.end('Method not allowed');
        return;
    }

    await serveStaticFile(request, response, requestUrl.pathname);
}

fs.mkdirSync(TRANSFER_DIR, { recursive: true });
fs.readdirSync(TRANSFER_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.3mf'))
    .forEach((entry) => {
        fs.unlinkSync(path.join(TRANSFER_DIR, entry.name));
    });
const cleanupTimer = setInterval(() => {
    void cleanupExpiredTransfers();
}, 60 * 1000);
cleanupTimer.unref();

const server = http.createServer((request, response) => {
    void requestHandler(request, response);
});

server.listen(PORT, HOST, () => {
    console.log(`Genesis Image Converter listening on http://${HOST}:${PORT}`);
});

function shutdown() {
    clearInterval(cleanupTimer);
    server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
