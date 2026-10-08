const encoder = new TextEncoder();
const decoder = new TextDecoder();
const issuerKey = import.meta.env?.VITE_RESPONDER_ISSUER_PUBLIC_KEY || '';
const REVOCATIONS_KEY = 'rescue.responder_revocations';

export function toBase64(bytes) {
  return btoa(Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join(''));
}
export function fromBase64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function nonce() { return toBase64(crypto.getRandomValues(new Uint8Array(32))); }

// Android/Python ECDSA signatures use DER; WebCrypto uses a fixed-width r || s.
export function rawSignature(signature) {
  const bytes = fromBase64(signature);
  if (bytes.length === 64) return bytes;
  if (bytes[0] !== 0x30 || bytes[2] !== 0x02) throw new Error('Invalid signature encoding');
  const rLength = bytes[3], sPosition = 4 + rLength;
  if (bytes[sPosition] !== 0x02 || sPosition + 2 + bytes[sPosition + 1] !== bytes.length) throw new Error('Invalid signature');
  const result = new Uint8Array(64);
  const r = bytes.slice(4, sPosition), s = bytes.slice(sPosition + 2);
  for (const [value, offset] of [[r, 0], [s, 32]]) {
    const n = value[0] === 0 ? value.slice(1) : value;
    if (n.length > 32) throw new Error('Invalid signature size');
    result.set(n, offset + 32 - n.length);
  }
  return result;
}

export async function verifySignature(publicKey, signature, bytes) {
  try {
    const key = await crypto.subtle.importKey('spki', fromBase64(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, rawSignature(signature), bytes);
  } catch { return false; }
}

export function credentialTrustConfigured() { return Boolean(issuerKey); }

export async function verifySignedDocument(document, trustedKey = issuerKey) {
  if (!trustedKey || !document?.payload || !document.signature) return null;
  const bytes = fromBase64(document.payload);
  if (!await verifySignature(trustedKey, document.signature, bytes)) return null;
  return JSON.parse(decoder.decode(bytes));
}

export async function verifyResponder(identity, now = Date.now(), trustedKey = issuerKey) {
  try {
    const claims = await verifySignedDocument(identity.certificate, trustedKey);
    if (!claims || claims.version !== 1 || claims.role !== 'responder' || claims.issuer !== 'rescuememory-command' ||
      claims.node_id !== identity.node_id || claims.public_key !== identity.public_key ||
      claims.not_before * 1000 > now || claims.expires * 1000 <= now) return false;
    const revocations = JSON.parse(localStorage.getItem(REVOCATIONS_KEY) || 'null');
    const list = revocations ? await verifySignedDocument(revocations, trustedKey) : null;
    return !list?.serials?.includes(claims.serial);
  } catch { return false; }
}

export async function cacheRevocations(document) {
  const claims = await verifySignedDocument(document);
  if (!claims || !Array.isArray(claims.serials) || !Number.isFinite(claims.issued_at) || claims.issued_at * 1000 > Date.now() + 300000)
    throw new Error('Revocation list is not signed by the trusted issuer.');
  const old = JSON.parse(localStorage.getItem(REVOCATIONS_KEY) || 'null');
  const previous = old ? await verifySignedDocument(old) : null;
  if (previous && previous.issued_at > claims.issued_at) throw new Error('Outdated revocation list.');
  localStorage.setItem(REVOCATIONS_KEY, JSON.stringify(document));
}

export async function ephemeralKey() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privateKey: keys.privateKey, public_key: toBase64(await crypto.subtle.exportKey('spki', keys.publicKey)) };
}

export function transcript(hello, reply) {
  return JSON.stringify(['rescuememory-v2', reply.session_id, hello.identity.node_id, reply.identity.node_id,
    hello.identity.public_key, reply.identity.public_key, hello.nonce, reply.nonce, hello.ephemeral, reply.ephemeral]);
}

export async function sessionKey(privateKey, remoteKey, text) {
  const peerKey = await crypto.subtle.importKey('spki', fromBase64(remoteKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const salt = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('rescuememory-v2-data') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(session, message) {
  const seq = ++session.outbound;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`${session.id}|${session.localId}|${seq}`);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, session.key,
    encoder.encode(JSON.stringify(message)));
  return { v: 2, type: 'secure', session_id: session.id, seq, iv: toBase64(iv), data: toBase64(encrypted) };
}

export async function unseal(session, envelope) {
  if (envelope.type !== 'secure' || envelope.session_id !== session.id || !Number.isSafeInteger(envelope.seq) || envelope.seq <= session.inbound)
    throw new Error('Invalid or replayed sync message.');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv),
    additionalData: encoder.encode(`${session.id}|${session.peerId}|${envelope.seq}`) }, session.key, fromBase64(envelope.data));
  session.inbound = envelope.seq;
  return JSON.parse(decoder.decode(bytes));
}

export const signingBytes = text => toBase64(encoder.encode(text));
