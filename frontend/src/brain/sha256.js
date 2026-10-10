// SHA-256 fallback for browser HTTP origins without Web Crypto. Using a different
// hash in that environment would give the same report different cloud point IDs.
export async function sha256Bytes(text) {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const initial = [], constants = [];
  for (let candidate = 2; constants.length < 64; candidate++) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor++)
      if (candidate % divisor === 0) { prime = false; break; }
    if (!prime) continue;
    if (initial.length < 8) initial.push((Math.sqrt(candidate) % 1 * 2 ** 32) >>> 0);
    constants.push((Math.cbrt(candidate) % 1 * 2 ** 32) >>> 0);
  }
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 2 ** 29));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
  const rotate = (value, count) => (value >>> count) | (value << (32 - count));
  const words = new Uint32Array(64), state = [...initial];
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3))
        + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
        + ((e & f) ^ (~e & g)) + constants[i] + words[i]) >>> 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22))
        + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [a, b, c, d, e, f, g, h] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => { state[i] = (state[i] + value) >>> 0; });
  }
  const digest = new Uint8Array(32), output = new DataView(digest.buffer);
  state.forEach((value, i) => output.setUint32(i * 4, value));
  return digest;
}
