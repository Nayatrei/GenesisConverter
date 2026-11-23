const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const assets = ['icon-512.png', 'icon-192.png', 'favicon.ico', 'favicon-16x16.png',
    'favicon-32x32.png', 'apple-touch-icon.png', 'maskable-icon-192.png', 'maskable-icon-512.png'];
const hash = crypto.createHash('sha256');
for (const name of assets) hash.update(name).update(fs.readFileSync(path.join(root, name)));
const version = 'brand-' + hash.digest('hex').slice(0, 16);

function syncBrandIcons() {
    const head = `<!-- BRAND-ICONS:start -->
    <link rel="icon" type="image/x-icon" href="/favicon.ico?v=${version}">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=${version}">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=${version}">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${version}">
    <link rel="manifest" href="/manifest.webmanifest?v=${version}">
    <!-- BRAND-ICONS:end -->`;
    const files = [
        ...fs.readdirSync(root).filter(name => name.endsWith('.html')),
        ...fs.readdirSync(path.join(root, 'guides')).filter(name => name.endsWith('.html')).map(name => 'guides/' + name),
        'auth/callback/index.html', 'modules/partials/header.html'
    ];
    for (const name of files) {
        const file = path.join(root, name);
        let html = fs.readFileSync(file, 'utf8');
        if (html.includes('</head>')) {
            html = html.replace(/\s*<!-- BRAND-ICONS:start -->[\s\S]*?<!-- BRAND-ICONS:end -->/g, '')
                .replace(/\s*<link\b[^>]*rel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g, '')
                .replace('</head>', `    ${head}\n</head>`);
        }
        html = html.replace(/(src=")\/icon-192\.png(?:\?[^" ]*)?"/g, `$1/icon-192.png?v=${version}"`)
            .replace(/(content=")https:\/\/editor\.genesisframeworks\.com\/icon-512\.png(?:\?[^" ]*)?"/g,
                `$1https://editor.genesisframeworks.com/icon-512.png?v=${version}"`);
        fs.writeFileSync(file, html);
    }
    const file = path.join(root, 'manifest.webmanifest');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const icon of manifest.icons) icon.src = icon.src.split('?')[0] + '?v=' + version;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    return version;
}
module.exports = { syncBrandIcons };
