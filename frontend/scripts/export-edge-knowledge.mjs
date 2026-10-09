import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(frontend, '../backend/data/knowledge.json');
const cards = JSON.parse(readFileSync(source, 'utf8'));
if (!Array.isArray(cards) || !cards.length || new Set(cards.map(card => card.id)).size !== cards.length ||
    cards.some(card => typeof card.id !== 'string' || !card.id || !card.title)) throw new Error('Invalid or duplicate emergency cards.');
const bm25 = { language: 'english', k: 1.2, b: 0.75, avg_len: 256 };
const version = createHash('sha256').update(JSON.stringify({ bm25, cards })).digest('hex');
const pack = JSON.stringify({ version, engine_version: '0.8.0', card_count: cards.length, bm25, cards });
const output = resolve(frontend, 'android/app/src/main/assets/qdrant/knowledge-pack.json');
mkdirSync(dirname(output), { recursive: true });
if (!existsSync(output) || readFileSync(output, 'utf8') !== pack) writeFileSync(output, pack);
console.log(`Android Edge pack: ${cards.length} cards, ${version.slice(0, 12)}.`);
