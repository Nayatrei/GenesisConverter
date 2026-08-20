const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const canonicalEntrypoint = path.join(root, '3d-obj.html');
const namedEntrypoints = ['logo.html', 'raster.html', 'annotate.html', 'bulk.html', 'pdf.html', 'svg.html'];

for (const filename of namedEntrypoints) {
    fs.copyFileSync(canonicalEntrypoint, path.join(root, filename));
}

console.log(`Synchronized ${namedEntrypoints.length} entrypoints from 3d-obj.html.`);
