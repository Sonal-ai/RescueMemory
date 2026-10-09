import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Consume only the C ABI/static engine from this distribution; no React Native,
// Nitro, JavaScript module, or package install script is executed.
export const nativeDistribution = Object.freeze({
  package: 'react-native-qdrant-edge', version: '0.4.1', engine: '0.8.0',
  url: 'https://registry.npmjs.org/react-native-qdrant-edge/-/react-native-qdrant-edge-0.4.1.tgz',
  integrity: 'sha512-XZ4vRhtSYi33BkKLvAszOxhWKJGMFsRqhuJ9KMQ45WgjZA7Ud7Sw63FIZH3jbgwR5fImdvRt4VA3vXy3koqWVw==',
});
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = resolve(frontend, '.native-cache');
const destination = resolve(cacheRoot, 'qdrant-edge-ffi-0.4.1');
const files = ['cpp/qdrant_edge_ffi.h',
  'android/src/main/jniLibs/arm64-v8a/libqdrant_edge_ffi.a',
  'android/src/main/jniLibs/x86_64/libqdrant_edge_ffi.a',
  'rust/qdrant-edge-ffi/Cargo.toml', 'rust/qdrant-edge-ffi/Cargo.lock'];
const sha256 = data => createHash('sha256').update(data).digest('hex');

function download(url, redirects = 0) {
  return new Promise((resolveDownload, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'registry.npmjs.org' || redirects > 3) {
      reject(new Error('Unexpected native distribution download URL.')); return;
    }
    const request = get(url, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        download(new URL(response.headers.location, url).href, redirects + 1).then(resolveDownload, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Native download HTTP ${response.statusCode}`)); return; }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 150 * 1024 * 1024) { response.destroy(new Error('Native archive exceeds size limit.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolveDownload(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error('Native engine download timed out.')));
    request.on('error', reject);
  });
}

export async function prepareNative() {
  const receiptPath = resolve(destination, 'verified.json');
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.integrity !== nativeDistribution.integrity ||
        files.some(file => !existsSync(resolve(destination, file)) || sha256(readFileSync(resolve(destination, file))) !== receipt.files[file])) {
      throw new Error('Native cache integrity check failed. Remove frontend/.native-cache/qdrant-edge-ffi-0.4.1 and rerun prepare:edge.');
    }
    console.log('Verified cached Qdrant Edge 0.8.0 (C FFI 0.4.1).');
    return destination;
  }
  if (existsSync(destination)) throw new Error('Incomplete native cache. Remove the versioned cache directory and retry.');
  mkdirSync(cacheRoot, { recursive: true });
  const stage = resolve(cacheRoot, `download-${randomUUID()}`);
  mkdirSync(stage);
  try {
    const archive = process.env.QDRANT_EDGE_ARCHIVE
      ? readFileSync(resolve(process.env.QDRANT_EDGE_ARCHIVE)) : await download(nativeDistribution.url);
    const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
    if (integrity !== nativeDistribution.integrity) throw new Error('Qdrant native archive failed its pinned SHA-512 check.');
    const archivePath = resolve(stage, 'native.tgz');
    writeFileSync(archivePath, archive);
    execFileSync('tar', ['-xf', archivePath, '-C', stage, '--strip-components=1', ...files.map(file => `package/${file}`)]);
    // The source manifest is shipped alongside the engine; fail on a changed crate.
    if (!readFileSync(resolve(stage, files[3]), 'utf8').includes('qdrant-edge = "0.8.0"')) throw new Error('Unexpected native engine manifest.');
    writeFileSync(resolve(stage, 'verified.json'), JSON.stringify({ ...nativeDistribution,
      files: Object.fromEntries(files.map(file => [file, sha256(readFileSync(resolve(stage, file)))])) }, null, 2));
    // Windows scanners may keep an extracted directory open, preventing rename.
    // Copy only the known files and publish the verification receipt last.
    for (const file of files) {
      mkdirSync(dirname(resolve(destination, file)), { recursive: true });
      copyFileSync(resolve(stage, file), resolve(destination, file));
    }
    copyFileSync(resolve(stage, 'verified.json'), receiptPath);
    console.log('Prepared verified Qdrant Edge 0.8.0 for arm64-v8a and x86_64.');
    return destination;
  } finally {
    // Only remove this invocation's task-owned staging directory, never shard data.
    const owned = relative(cacheRoot, stage);
    if (owned.startsWith('download-') && !owned.includes(sep) && existsSync(stage)) rmSync(stage, { recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareNative();
