const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const canonicalEntrypoint = path.join(root, '3d-obj.html');
const pages = require('../seo-pages.json');
const origin = 'https://editor.genesisframeworks.com';
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const shell = fs.readFileSync(canonicalEntrypoint, 'utf8')
    .replace(/\s*<!-- SEO:start -->[\s\S]*?<!-- SEO:end -->\s*/g, '\n')
    .replace(/\s*<title>[\s\S]*?<\/title>/g, '')
    .replace(/\s*<meta (?:name="(?:description|keywords)"|property="og:[^"]+")[^>]*>/g, '');

for (const slug of [...Object.keys(pages), 'svg']) {
    const canonicalSlug = slug === 'svg' ? '3d-obj' : slug;
    const page = pages[canonicalSlug];
    const url = `${origin}/${canonicalSlug}`;
    const head = `\n    <!-- SEO:start -->
    <title>${escape(page.title)}</title>
    <meta name="description" content="${escape(page.description)}">
    <link rel="canonical" href="${url}">
    <meta property="og:title" content="${escape(page.title)}">
    <meta property="og:description" content="${escape(page.description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${origin}/icon-512.png">
    <script type="application/json" id="seo-pages">${JSON.stringify(pages).replaceAll('<', '\\u003c')}</script>
    <!-- SEO:end -->`;
    fs.writeFileSync(path.join(root, `${slug}.html`), shell.replace('</head>', `${head}\n</head>`));
}

const urls = ['/', ...Object.keys(pages).map(slug => `/${slug}`),
    '/guides/', '/guides/image-to-stl.html', '/guides/logo-to-3mf.html'];
fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${origin}${url}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log('Synchronized app shells, unique page metadata and public sitemap.');
