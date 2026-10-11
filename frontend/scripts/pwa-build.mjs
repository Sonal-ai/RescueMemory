import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const SHELL_ASSETS = ['/', '/index.html', '/manifest.json', '/favicon.ico',
  '/favicon.png', '/favicon.svg', '/icon-192.png', '/icon-512.png',
  '/icon-maskable-512.png', '/logo.png', '/data/knowledge_cards.json', '/data/knowledge_vectors.json'];

export function buildWorker(template, html, filenames) {
  const assets = [...SHELL_ASSETS, ...filenames.filter(name => /\.(js|css)$/.test(name)).sort().map(name => `/${name}`)];
  const version = createHash('sha256').update(template).update(html).update(JSON.stringify(assets)).digest('hex').slice(0, 16);
  return template.replace(/const CACHE_NAME = [^;]+;/, `const CACHE_NAME = 'rescue-memory-pwa-${version}';`)
    .replace(/const PRECACHE_ASSETS = \[[\s\S]*?\];/, `const PRECACHE_ASSETS = ${JSON.stringify(assets)};`);
}

export function pwaBuild() {
  let root;
  return {
    name: 'rescue-pwa-build', apply: 'build',
    configResolved(config) { root = config.root; },
    async writeBundle(output, bundle) {
      const directory = resolve(root, output.dir);
      const [template, html] = await Promise.all([
        readFile(resolve(root, 'public/sw.js'), 'utf8'), readFile(resolve(directory, 'index.html'), 'utf8'),
      ]);
      await writeFile(resolve(directory, 'sw.js'), buildWorker(template, html, Object.keys(bundle)));
    },
  };
}
