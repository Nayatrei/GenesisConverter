const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const RELEASE_VERSION_PATTERN = /^r-[a-f0-9]{16}$/;
const GENERATED_VERSION_PLACEHOLDER = '__GENESIS_RELEASE__';

function walkFiles(directory, predicate = () => true) {
    if (!fs.existsSync(directory)) return [];
    const results = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(fullPath, predicate));
        } else if (predicate(fullPath, entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
}

function isActiveRuntimeFile(_filePath, filename) {
    return /\.(?:js|mjs)$/.test(filename) && !/ \d+\.(?:js|mjs)$/.test(filename);
}

const runtimeFiles = [
    path.join(root, 'converter.js'),
    path.join(root, 'three-setup.js'),
    ...walkFiles(path.join(root, 'modules'), isActiveRuntimeFile),
    ...walkFiles(path.join(root, 'vendor', 'three'), isActiveRuntimeFile)
];

const releaseHashFiles = [...new Set([
    path.join(root, 'app-bootstrap.js'),
    path.join(root, 'genesis-id.js'),
    path.join(root, 'genesis-id.css'),
    path.join(root, 'converter.js'),
    path.join(root, 'three-setup.js'),
    path.join(root, 'imagetracer_v1.2.6.js'),
    path.join(root, 'style.css'),
    path.join(root, 'annotate.css'),
    path.join(root, 'landing.css'),
    path.join(root, 'landing.js'),
    path.join(root, '3d-obj.html'),
    path.join(root, 'index.html'),
    path.join(root, 'auth', 'callback', 'index.html'),
    ...walkFiles(path.join(root, 'modules'), (_filePath, filename) => !/ \d+\.[^.]+$/.test(filename)),
    ...walkFiles(path.join(root, 'vendor'), (_filePath, filename) => !filename.startsWith('.'))
])].sort((left, right) => left.localeCompare(right));

const moduleSpecifierPatterns = [
    /(\bfrom\s*['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))(?:\?v=[^'"]*)?(['"])/g,
    /(^\s*import\s*['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))(?:\?v=[^'"]*)?(['"])/gm,
    /(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))(?:\?v=[^'"]*)?(['"]\s*\))/g,
    /(\bnew URL\(\s*['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))(?:\?v=[^'"]*)?(['"]\s*,\s*import\.meta\.url\s*\))/g
];

function stampModuleSpecifiers(source, version) {
    return moduleSpecifierPatterns.reduce(
        (result, pattern) => result.replace(pattern, '$1$2?v=' + version + '$3'),
        source
    );
}

function normalizeTextForReleaseHash(filePath, source) {
    const extension = path.extname(filePath).toLowerCase();
    let normalized = source;
    if (extension === '.js' || extension === '.mjs') {
        normalized = stampModuleSpecifiers(normalized, GENERATED_VERSION_PLACEHOLDER);
    }
    if (extension === '.html') {
        normalized = normalized
            .replace(/(app-bootstrap\.js)\?v=[^"']+/g, '$1?v=' + GENERATED_VERSION_PLACEHOLDER)
            .replace(/(style\.css)\?v=[^"']+/g, '$1?v=' + GENERATED_VERSION_PLACEHOLDER)
            .replace(/(annotate\.css)\?v=[^"']+/g, '$1?v=' + GENERATED_VERSION_PLACEHOLDER)
            .replace(/(landing\.css)\?v=[^"']+/g, '$1?v=' + GENERATED_VERSION_PLACEHOLDER)
            .replace(/(landing\.js)\?v=[^"']+/g, '$1?v=' + GENERATED_VERSION_PLACEHOLDER)
            .replace(/(genesis-id\.css)\?v=[^"']+/g, '$1?v=' + GENERATED_VERSION_PLACEHOLDER)
            .replace(/(genesis-id\.js)\?v=[^"']+/g, '$1?v=' + GENERATED_VERSION_PLACEHOLDER);
    }
    return normalized;
}

function computeReleaseVersion() {
    const hash = crypto.createHash('sha256');
    for (const filePath of releaseHashFiles) {
        if (!fs.existsSync(filePath)) {
            throw new Error('Release input is missing: ' + path.relative(root, filePath));
        }
        const relativePath = path.relative(root, filePath).split(path.sep).join('/');
        const buffer = fs.readFileSync(filePath);
        hash.update(relativePath);
        hash.update('\0');
        if (/\.(?:css|html|js|mjs)$/.test(filePath)) {
            hash.update(normalizeTextForReleaseHash(filePath, buffer.toString('utf8')));
        } else {
            hash.update(buffer);
        }
        hash.update('\0');
    }
    return 'r-' + hash.digest('hex').slice(0, 16);
}

function readManifest() {
    const manifestPath = path.join(root, 'app-version.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schema !== 1 || typeof manifest.version !== 'string') {
        throw new Error('app-version.json must contain schema 1 and a release version.');
    }
    return manifest;
}

function writeOrCheck(filePath, desiredSource, failures) {
    const currentSource = fs.readFileSync(filePath, 'utf8');
    if (currentSource === desiredSource) return;
    if (checkOnly) {
        failures.push(path.relative(root, filePath));
        return;
    }
    fs.writeFileSync(filePath, desiredSource);
}

function main() {
    const version = computeReleaseVersion();
    if (!RELEASE_VERSION_PATTERN.test(version)) {
        throw new Error('Generated invalid release version: ' + version);
    }

    const failures = [];
    const manifestPath = path.join(root, 'app-version.json');
    const manifest = readManifest();
    const desiredManifest = JSON.stringify({ schema: 1, version }, null, 2) + '\n';
    if (manifest.version !== version || fs.readFileSync(manifestPath, 'utf8') !== desiredManifest) {
        if (checkOnly) failures.push('app-version.json');
        else fs.writeFileSync(manifestPath, desiredManifest);
    }

    for (const filePath of runtimeFiles) {
        const source = fs.readFileSync(filePath, 'utf8');
        writeOrCheck(filePath, stampModuleSpecifiers(source, version), failures);
    }

    const toolEntrypoints = [
        '3d-obj.html',
        'logo.html',
        'raster.html',
        'annotate.html',
        'bulk.html',
        'pdf.html',
        'svg.html'
    ];
    for (const filename of toolEntrypoints) {
        const filePath = path.join(root, filename);
        const source = fs.readFileSync(filePath, 'utf8');
        const stamped = source
            .replace(/(app-bootstrap\.js)\?v=[^"']+/g, '$1?v=' + version)
            .replace(/(style\.css)\?v=[^"']+/g, '$1?v=' + version)
            .replace(/(annotate\.css)\?v=[^"']+/g, '$1?v=' + version)
            .replace(/(genesis-id\.css)\?v=[^"']+/g, '$1?v=' + version)
            .replace(/(genesis-id\.js)\?v=[^"']+/g, '$1?v=' + version);
        writeOrCheck(filePath, stamped, failures);
    }

    const landingPath = path.join(root, 'index.html');
    const landing = fs.readFileSync(landingPath, 'utf8');
    const stampedLanding = landing
        .replace(/(landing\.css)\?v=[^"']+/g, '$1?v=' + version)
        .replace(/(annotate\.css)\?v=[^"']+/g, '$1?v=' + version)
        .replace(/(landing\.js)\?v=[^"']+/g, '$1?v=' + version)
        .replace(/(genesis-id\.css)\?v=[^"']+/g, '$1?v=' + version)
        .replace(/(genesis-id\.js)\?v=[^"']+/g, '$1?v=' + version);
    writeOrCheck(landingPath, stampedLanding, failures);

    const callbackPath = path.join(root, 'auth', 'callback', 'index.html');
    const callback = fs.readFileSync(callbackPath, 'utf8');
    const stampedCallback = callback
        .replace(/(genesis-id\.css)\?v=[^"']+/g, '$1?v=' + version)
        .replace(/(genesis-id\.js)\?v=[^"']+/g, '$1?v=' + version);
    writeOrCheck(callbackPath, stampedCallback, failures);

    if (failures.length) {
        throw new Error(
            'Release cache graph is stale. Run npm run build.\n'
            + failures.map((file) => '- ' + file).join('\n')
        );
    }

    if (!checkOnly) {
        const verifiedVersion = computeReleaseVersion();
        if (verifiedVersion !== version) {
            throw new Error('Release hash changed while stamping (' + version + ' -> ' + verifiedVersion + ').');
        }
    }

    console.log(
        (checkOnly ? 'Verified' : 'Synchronized')
        + ' content release ' + version
        + ' across ' + runtimeFiles.length + ' modules.'
    );
}

if (require.main === module) main();

module.exports = {
    RELEASE_VERSION_PATTERN,
    computeReleaseVersion,
    stampModuleSpecifiers
};
