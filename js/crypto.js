// 端對端加密工具。金鑰由「同步密語」導出，密語只留在裝置上，
// 上傳出去的永遠是密文——GitHub 看不到內容。
const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ROUNDS = 250000;

export function randomPassphrase() {
  // 32 個 Crockford base32 字元 ≈ 160 bits，分組讓人抄得動
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase.replace(/-/g, '')), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 回傳可直接存成 JSON 的密文信封 */
export async function encryptJson(passphrase, value) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)),
  );
  return {
    v: 1,
    alg: 'PBKDF2-SHA256/AES-256-GCM',
    rounds: PBKDF2_ROUNDS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(new Uint8Array(cipher)),
  };
}

export async function decryptJson(passphrase, envelope) {
  if (!envelope?.data) throw new Error('同步檔案格式不對。');
  const salt = fromB64(envelope.salt);
  const iv = fromB64(envelope.iv);
  const key = await deriveKey(passphrase, salt);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromB64(envelope.data));
  } catch {
    throw new Error('同步密語不對，解不開雲端上的資料。');
  }
  return JSON.parse(dec.decode(plain));
}

export function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(text) {
  const bin = atob((text || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** UTF-8 字串 → base64（GitHub API 需要） */
export function utf8ToB64(text) {
  return toB64(enc.encode(text));
}

export function b64ToUtf8(b64) {
  return dec.decode(fromB64(b64));
}
