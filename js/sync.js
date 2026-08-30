// 跨裝置同步：把加密後的資料放在 GitHub 的一個 JSON 檔裡。
//
// 安全前提：
//  1. 加密在裝置上完成，GitHub 只看得到密文（連 GitHub 也解不開）
//  2. 建議把這個檔案放在「另一個 private repo」，不要放進公開的 Pages repo
//  3. Token 用 fine-grained PAT，只給那一個 repo 的 Contents 讀寫權限
import { settings, face as faceStore, pin as pinStore } from './store.js';
import { encryptJson, decryptJson, utf8ToB64, b64ToUtf8 } from './crypto.js';

const API = 'https://api.github.com';

// 會跟著同步的設定。刻意不含裝置相關的偏好
//（語音、語速、辨識嚴格度都跟該台裝置的硬體與環境有關）。
export const SYNCED_KEYS = [
  'ownerName', 'assistantName', 'persona', 'memory', 'autoMemory',
  'provider', 'apiKey', 'geminiKey', 'workspaceId', 'proxyUrl',
  'model', 'geminiModel', 'effort',
];

export function isConfigured(s = settings.all()) {
  return !!(s.syncRepo && s.syncToken && s.syncPass);
}

// ── 連結碼：把 repo / 路徑 / token / 密語 打包成一串，新裝置貼一次就好 ──
export function makeLinkCode(s = settings.all()) {
  const payload = { r: s.syncRepo, p: s.syncPath, t: s.syncToken, k: s.syncPass };
  return `JARVIS1.${utf8ToB64(JSON.stringify(payload)).replace(/=+$/, '')}`;
}

export function parseLinkCode(code) {
  const body = (code || '').trim().replace(/^JARVIS1\./, '');
  let payload;
  try {
    payload = JSON.parse(b64ToUtf8(body));
  } catch {
    throw new Error('連結碼看起來不完整，請重新複製一次。');
  }
  if (!payload.r || !payload.t || !payload.k) throw new Error('連結碼缺少必要資訊。');
  return {
    syncRepo: payload.r,
    syncPath: payload.p || 'data.json',
    syncToken: payload.t,
    syncPass: payload.k,
  };
}

// ── GitHub Contents API ──
function ghHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

async function ghError(res) {
  let msg = '';
  try { msg = (await res.json())?.message || ''; } catch { /* 忽略 */ }
  if (res.status === 401) return new Error('GitHub Token 無效或已過期，請重新產生一把。');
  if (res.status === 403) return new Error(`GitHub 拒絕存取：${msg || '請確認 Token 有這個 repo 的 Contents 讀寫權限'}。`);
  if (res.status === 404) return new Error('找不到這個 repo 或路徑，請確認 owner/repo 拼法與 Token 權限。');
  if (res.status === 409) return new Error('雲端上的檔案剛剛被別台裝置改過，請再同步一次。');
  if (res.status === 422) return new Error(`GitHub 不接受這次寫入：${msg}`);
  return new Error(msg || `GitHub 回應錯誤（${res.status}）。`);
}

async function readRemote(s) {
  const url = `${API}/repos/${s.syncRepo}/contents/${encodeURIComponent(s.syncPath)}`;
  const res = await fetch(`${url}?t=${Date.now()}`, { headers: ghHeaders(s.syncToken), cache: 'no-store' });
  if (res.status === 404) return { envelope: null, sha: null };  // 還沒建立過
  if (!res.ok) throw await ghError(res);
  const body = await res.json();
  let envelope = null;
  try {
    envelope = JSON.parse(b64ToUtf8(body.content || ''));
  } catch {
    throw new Error('雲端上的同步檔案讀不出來，可能被改壞了。');
  }
  return { envelope, sha: body.sha };
}

async function writeRemote(s, envelope, sha) {
  const url = `${API}/repos/${s.syncRepo}/contents/${encodeURIComponent(s.syncPath)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(s.syncToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      // 固定訊息：commit 歷史是公開的元資料，不必在裡面寫這是什麼 App
      message: 'update',
      content: utf8ToB64(JSON.stringify(envelope, null, 2)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw await ghError(res);
  return res.json();
}

// ── 本機快照 ──
function snapshot() {
  const s = settings.all();
  const data = { v: 1, updatedAt: s.updatedAt || 0, settings: {} };
  for (const k of SYNCED_KEYS) data.settings[k] = s[k];
  if (s.syncFace !== false) {
    const f = faceStore.load();
    if (f) data.face = { enrolledAt: f.enrolledAt, samples: f.samples.map((d) => Array.from(d)) };
  }
  // 備用密碼存的是加鹽雜湊，跟著加密內容一起走，新裝置配對完就不用再設一次
  const p = pinStore.raw();
  if (p) data.pin = p;
  return data;
}

/**
 * 合併規則：
 * - 長期記憶取聯集（兩台裝置可能各自記到不同的事，不能互相蓋掉）
 * - 其他設定以「比較新的那一份」為準
 * - 臉部檔案取建檔時間較新的那一份
 */
const isBlank = (v) => v === undefined || v === null || v === '';

export function merge(local, remote) {
  if (!remote) return { data: local, changed: false };

  // 以較新的那一份為主，但「空值」不會蓋掉另一邊的內容——
  // 沒有這條的話，一台還沒填金鑰的新裝置會把雲端的金鑰洗掉。
  const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  const [newer, older] = localNewer
    ? [local.settings || {}, remote.settings || {}]
    : [remote.settings || {}, local.settings || {}];
  const base = {};
  for (const k of SYNCED_KEYS) {
    base[k] = isBlank(newer[k]) && !isBlank(older[k]) ? older[k] : newer[k];
  }

  const lines = (text) => (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const memory = [...lines(local.settings.memory)];
  for (const line of lines(remote.settings?.memory)) {
    if (!memory.some((l) => l.toLowerCase() === line.toLowerCase())) memory.push(line);
  }
  base.memory = memory.join('\n');

  const face = (remote.face?.enrolledAt || 0) > (local.face?.enrolledAt || 0) ? remote.face : local.face;
  const merged = { v: 1, updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0), settings: base };
  if (face) merged.face = face;
  const pinRec = local.pin || remote.pin;
  if (pinRec) merged.pin = pinRec;

  const changed = JSON.stringify(merged.settings) !== JSON.stringify(local.settings)
    || (face?.enrolledAt || 0) !== (local.face?.enrolledAt || 0);
  return { data: merged, changed };
}

function applyLocally(data) {
  const patch = {};
  for (const k of SYNCED_KEYS) if (data.settings[k] !== undefined) patch[k] = data.settings[k];
  // touch:false —— 這是同步寫回來的，不算「這台裝置改了設定」
  settings.patch({ ...patch, updatedAt: data.updatedAt || 0 }, { touch: false });
  if (data.face?.samples?.length && settings.get('syncFace') !== false) {
    const local = faceStore.load();
    if ((data.face.enrolledAt || 0) > (local?.enrolledAt || 0)) {
      faceStore.save(data.face.samples.map((a) => Float32Array.from(a)));
    }
  }
  if (data.pin && !pinStore.exists()) pinStore.restore(data.pin);
}

/**
 * 同步一次：抓下來 → 合併 → 需要時寫回去。
 * 回傳 { pulled, pushed }
 */
export async function syncNow() {
  const s = settings.all();
  if (!isConfigured(s)) throw new Error('還沒設定同步，請先填 repo、Token 與密語。');

  const { envelope, sha } = await readRemote(s);
  const remote = envelope ? await decryptJson(s.syncPass, envelope) : null;
  const local = snapshot();
  const { data, changed } = merge(local, remote);

  // 遠端沒有、或內容跟合併結果不同，就寫回去
  const remoteStale = !remote
    || JSON.stringify(remote.settings) !== JSON.stringify(data.settings)
    || (remote.face?.enrolledAt || 0) !== (data.face?.enrolledAt || 0);
  if (remoteStale) data.updatedAt = Date.now();

  if (changed || remoteStale) applyLocally(data);
  if (remoteStale) await writeRemote(s, await encryptJson(s.syncPass, data), sha);

  settings.patch({ syncLastAt: Date.now() }, { touch: false });
  return { pulled: changed, pushed: remoteStale };
}

// ── 背景自動同步：合併短時間內的多次變更 ──
let timer = null;
let running = false;
let onStatus = null;

export function setStatusHandler(fn) {
  onStatus = fn;
}

export function schedule(delay = 4000) {
  if (!isConfigured() || settings.get('syncEnabled') === false) return;
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

export async function run() {
  if (running || !isConfigured() || settings.get('syncEnabled') === false) return null;
  running = true;
  try {
    const result = await syncNow();
    onStatus?.({ ok: true, ...result });
    return result;
  } catch (err) {
    onStatus?.({ ok: false, message: err.message });
    return null;
  } finally {
    running = false;
  }
}
