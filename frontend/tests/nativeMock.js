import { parentPort, workerData } from 'node:worker_threads';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

const callbacks = new Map(), requests = new Map();
let nextId = 0, certificate = workerData.certificate;
let privateKey = createPrivateKey(workerData.privateKey), publicKey = workerData.publicKey, keyRotated = false;
parentPort.on('message', message => {
  if (message.type === 'native-event') callbacks.get(message.name)?.(message.event);
  if (message.type === 'native-response') {
    const waiting = requests.get(message.id); requests.delete(message.id);
    if (message.error) waiting?.reject(new Error(message.error)); else waiting?.resolve({ payload: message.payload });
  }
});
const plugin = {
  async getIdentity() { return { v: 2, node_id: workerData.id, name: `Phone ${workerData.id}`, public_key: publicKey, certificate }; },
  async getBattery() { return { battery: workerData.battery, charging: false, battery_measured_at: Date.now() }; },
  async setLocation() {},
  async sign({ data }) {
    if (workerData.rotateKeyOnSign && !keyRotated) {
      const replacement = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      privateKey = replacement.privateKey; publicKey = replacement.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'); keyRotated = true;
    }
    const signature = sign('sha256', Buffer.from(data, 'base64'), { key: privateKey,
      dsaEncoding: workerData.signatureFormat || 'der' });
    if (workerData.corruptProof) signature[signature.length - 1] ^= 1;
    return { signature: signature.toString('base64'), public_key: publicKey };
  },
  async verifyPhoneProof({ publicKey, signature, data }) {
    const bytes = Buffer.from(signature, 'base64');
    return { valid: verify('sha256', Buffer.from(data, 'base64'), {
      key: createPublicKey({ key: Buffer.from(publicKey, 'base64'), type: 'spki', format: 'der' }),
      dsaEncoding: bytes.length === 64 ? 'ieee-p1363' : 'der',
    }, bytes) };
  },
  async setCredential({ certificate: value }) { certificate = value; },
  async addListener(name, callback) { callbacks.set(name, callback); return { remove() { callbacks.delete(name); } }; },
  async start() {}, async stop() {},
  async scan() { return { peers: [{ address: workerData.peer, rssi: -52 }] }; },
  async connect() { return { v: 2, node_id: workerData.peer, name: `Phone ${workerData.peer}`, address: workerData.peer, ...workerData.peerBattery }; },
  async exchange({ payload }) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject });
      parentPort.postMessage({ type: 'native-request', from: workerData.id, to: workerData.peer, id, payload });
    });
  },
  async reply({ address, messageId, payload }) { parentPort.postMessage({ type: 'native-reply', from: workerData.id, to: address, id: messageId, payload }); },
  async disconnect() { parentPort.postMessage({ type: 'native-disconnect', from: workerData.id, to: workerData.peer }); },
};
export const Capacitor = { getPlatform: () => 'android' };
export const registerPlugin = () => plugin;
