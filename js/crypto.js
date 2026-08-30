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

// 密文長度會洩漏內容多寡（記了幾件事、有沒有存金鑰、今天多記了什麼），
// 所以加密前先用隨機資料把明文補滿到 BLOCK 的整數倍，讓檔案大小只剩幾個級距。
const BLOCK = 8192;

const PAD_FIELD = ',"_":""'.length; // 填充欄位本身佔的位元組

// 一定要用 UTF-8 位元組數算，不能用字串長度：
// 中文一個字是 3 個位元組，用字元數補的話，檔案大小仍會隨中文多寡變動。
function padTo(body) {
  const bodyBytes = enc.encode(body).length;
  const target = Math.max(BLOCK, Math.ceil((bodyBytes + PAD_FIELD + 32) / BLOCK) * BLOCK);
  const need = Math.max(0, target - bodyBytes - PAD_FIELD);
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(need * 0.75) + 3));
  return toB64(bytes).slice(0, need); // base64 是 ASCII，一個字元剛好一個位元組
}

/**
 * 回傳可直接存成 JSON 的密文信封。
 * 欄位名刻意取得中性、也不寫演算法名稱——不是為了增加破解難度
 * （密文本來就跟亂數無異），而是不要主動告訴撿到檔案的人這是什麼。
 */
export async function encryptJson(passphrase, value) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const body = JSON.stringify(value);
  const padded = `${body.slice(0, -1)},"_":"${padTo(body)}"}`;
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(padded),
  );
  return { v: 2, s: toB64(salt), i: toB64(iv), d: toB64(new Uint8Array(cipher)) };
}

export async function decryptJson(passphrase, envelope) {
  // v1 用的是 salt/iv/data，v2 改成短欄位名且加了填充
  const saltB64 = envelope?.s ?? envelope?.salt;
  const ivB64 = envelope?.i ?? envelope?.iv;
  const dataB64 = envelope?.d ?? envelope?.data;
  if (!dataB64 || !saltB64 || !ivB64) throw new Error('同步檔案格式不對。');

  const key = await deriveKey(passphrase, fromB64(saltB64));
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(dataB64),
    );
  } catch {
    throw new Error('同步密語不對，解不開雲端上的資料。');
  }
  const value = JSON.parse(dec.decode(plain));
  delete value._; // 填充用的隨機資料，用完就丟
  return value;
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
