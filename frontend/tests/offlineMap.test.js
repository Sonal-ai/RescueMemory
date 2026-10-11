import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OFFLINE_MAP_TILES, OFFLINE_MAP_BOUNDS, OFFLINE_MAP_CENTER, inOfflineMap, mapStartCenter } from '../src/brain/offlineMap.js';
import { buildWorker } from '../scripts/pwa-build.mjs';

test('map opens without GPS and outside coverage still displays saved cartography without inventing a GPS fix', () => {
  assert.equal(mapStartCenter(null, true), OFFLINE_MAP_CENTER);
  assert.equal(mapStartCenter(null, false), OFFLINE_MAP_CENTER);
  const measured = { lat: OFFLINE_MAP_CENTER.lat, lon: OFFLINE_MAP_CENTER.lon, timestamp: Date.now() };
  assert.equal(mapStartCenter(measured, true), measured);
  const outside = { lat: 0, lon: 0 };
  assert.equal(mapStartCenter(outside, true), OFFLINE_MAP_CENTER);
  assert.equal(mapStartCenter(outside, false), outside);
  assert.equal(inOfflineMap(outside), false);
  assert.ok(OFFLINE_MAP_BOUNDS[0][0] < OFFLINE_MAP_BOUNDS[1][0]);
});

test('every georeferenced offline map image is a packaged PNG and is precached for the website', async () => {
  assert.equal(OFFLINE_MAP_TILES.length, 9);
  for (const tile of OFFLINE_MAP_TILES) {
    const content = await readFile(new URL(`../public${tile.url}`, import.meta.url));
    assert.equal(content.subarray(1, 4).toString(), 'PNG');
    assert.ok(tile.bounds[0][0] < tile.bounds[1][0]);
    assert.ok(tile.bounds[0][1] < tile.bounds[1][1]);
  }
  const worker = buildWorker(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), 'app', OFFLINE_MAP_TILES.map(tile => tile.url.slice(1)));
  const manifest = JSON.parse(worker.match(/const PRECACHE_ASSETS = (\[[^;]+\]);/)[1]);
  OFFLINE_MAP_TILES.forEach(tile => assert.ok(manifest.includes(tile.url)));
});
