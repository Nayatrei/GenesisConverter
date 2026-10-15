import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const korean = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'test-results', 'playwright-report', 'archive', 'tests', 'scripts'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

test('all Editor HTML entry pages and the shared account widget use English without a language picker', async () => {
  const files = await htmlFiles(root.pathname);
  assert.ok(files.length >= 10);
  for (const path of files) {
    const html = await readFile(path, 'utf8');
    assert.doesNotMatch(html, korean, path);
    assert.doesNotMatch(html, /<html[^>]*\blang="ko"/u, path);
  }
  assert.doesNotMatch(await readFile(new URL('genesis-id.js', root), 'utf8'), korean);
});
