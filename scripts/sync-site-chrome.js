const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const header = fs.readFileSync(path.join(root, 'modules/partials/header.html'), 'utf8').trim();
const footer = fs.readFileSync(path.join(root, 'modules/partials/footer-brand.html'), 'utf8').trim();

// Build-time partials keep navigation and company details available without
// waiting for JS, while every page shares one maintained source.
function syncSiteChrome() {
    for (const [filename, current] of [
        ['index.html', 'home'], ['3d-obj.html', 'tool'],
        ['guides/index.html', 'guides'], ['guides/image-to-stl.html', 'guides'],
        ['guides/logo-to-3mf.html', 'guides']
    ]) {
        const filepath = path.join(root, filename);
        let source = fs.readFileSync(filepath, 'utf8');
        const pageHeader = header
            .replace(`data-nav-id="${current}"`, `data-nav-id="${current}" aria-current="page"`);
        const headerBlock = `<!-- HEADER:start -->\n${pageHeader}\n<!-- HEADER:end -->`;
        const footerBlock = `<!-- FOOTER:start -->\n${footer}\n<!-- FOOTER:end -->`;
        source = source.replace(/(?:<!-- HEADER:start -->\s*)?<header\b[^>]*>[\s\S]*?<\/header>(?:\s*<!-- HEADER:end -->)?/, headerBlock);
        if (source.includes('<!-- FOOTER:start -->')) {
            source = source.replace(/<!-- FOOTER:start -->[\s\S]*?<!-- FOOTER:end -->/, footerBlock);
        } else if (current === 'tool') {
            source = source.replace('<div id="footer-brand-slot"></div>', footerBlock);
        } else {
            source = source.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/, footerBlock);
        }
        if (!source.includes('src="/site-chrome.js?')) {
            source = source.replace('</head>', '    <script src="/site-chrome.js?v=r-0000000000000000" defer></script>\n</head>');
        }
        if (current === 'guides' && !source.includes('name="genesis-id-app-id"')) {
            source = source.replace('</head>', `    <meta name="genesis-id-origin" content="https://id.genesisframeworks.com">
    <meta name="genesis-id-app-id" content="genesis-editor">
    <meta name="genesis-id-callback-path" content="/auth/callback/">
    <link rel="stylesheet" href="/genesis-id.css?v=r-0000000000000000">
    <script src="/genesis-id.js?v=r-0000000000000000" defer></script>
</head>`);
        }
        fs.writeFileSync(filepath, source);
    }
}

module.exports = { syncSiteChrome };
