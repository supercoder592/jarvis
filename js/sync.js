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

/**
 * 從網址猜出 repo：App 掛在 owner.github.io/repo/ 底下時，
 * 同步檔預設就放回同一個 repo，使用者不用自己打。
 */
export function guessRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  if (!m) return '';
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return seg ? `${m[1]}/${seg}` : `${m[1]}/${m[1]}.github.io`;
}

// ── 連結碼：把 repo / 路徑 / token / 密語 打包成一串，新裝置貼一次就好 ──
export function makeLinkCode(s = settings.all()) {
  const payload = { r: s.syncRepo, p: s.syncPath, b: s.syncBranch, t: s.syncToken, k: s.syncPass };
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
    syncBranch: payload.b || 'jarvis-data',
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

/**
 * 同步檔放在獨立分支，不放 main。
 * 放 main 的話每同步一次就觸發一次 GitHub Pages 重新部署，
 * 又吵又可能撞到 Pages 的建置頻率限制——而 App 本身就是靠 Pages 在跑的。
 */
async function ensureBranch(s) {
  const branch = s.syncBranch;
  const ref = await fetch(`${API}/repos/${s.syncRepo}/git/ref/heads/${encodeURIComponent(branch)}`,
    { headers: ghHeaders(s.syncToken) });
  if (ref.ok) return;
  if (ref.status !== 404) throw await ghError(ref);

  // 分支不存在就從預設分支開一條
  const repoRes = await fetch(`${API}/repos/${s.syncRepo}`, { headers: ghHeaders(s.syncToken) });
  if (!repoRes.ok) throw await ghError(repoRes);
  const { default_branch: base } = await repoRes.json();

  const baseRef = await fetch(`${API}/repos/${s.syncRepo}/git/ref/heads/${encodeURIComponent(base)}`,
    { headers: ghHeaders(s.syncToken) });
  if (!baseRef.ok) throw await ghError(baseRef);
  const sha = (await baseRef.json()).object?.sha;

  const created = await fetch(`${API}/repos/${s.syncRepo}/git/refs`, {
    method: 'POST',
    headers: { ...ghHeaders(s.syncToken), 'content-type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  // 422 通常代表剛好被另一台裝置建好了
  if (!created.ok && created.status !== 422) throw await ghError(created);
}

/**
 * 沒有 token 也能讀（前提是 repo 公開）。
 * 新裝置就是靠這條路：只要一組密語就能把資料撈下來解開，
 * token 本身藏在加密內容裡，解開後才拿得到。
 */
export async function readPublic(s) {
  const url = `https://raw.githubusercontent.com/${s.syncRepo}/${encodeURIComponent(s.syncBranch)}/${s.syncPath}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) {
    throw new Error('雲端上還沒有資料，或這個 repo 不是公開的。公開的話請先在舊裝置同步一次；私有的話請改用 QR 配對。');
  }
  if (!res.ok) throw new Error(`讀不到雲端資料（${res.status}）。`);
  try {
    return await res.json();
  } catch {
    throw new Error('雲端上的檔案讀不出來，可能被改壞了。');
  }
}

async function readRemote(s) {
  const url = `${API}/repos/${s.syncRepo}/contents/${encodeURIComponent(s.syncPath)}`;
  const res = await fetch(`${url}?ref=${encodeURIComponent(s.syncBranch)}&t=${Date.now()}`,
    { headers: ghHeaders(s.syncToken), cache: 'no-store' });
  if (res.status === 404) return { envelope: null, sha: null };  // 檔案或分支還不存在
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
  if (!sha) await ensureBranch(s); // 第一次寫入才需要確認分支在不在
  const url = `${API}/repos/${s.syncRepo}/contents/${encodeURIComponent(s.syncPath)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(s.syncToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      // 固定訊息：commit 歷史是公開的元資料，不必在裡面寫這是什麼 App
      message: 'update',
      content: utf8ToB64(JSON.stringify(envelope, null, 2)),
      branch: s.syncBranch,
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
  // token 也放進加密內容：新裝置只憑密語把檔案讀下來解開後，就自帶寫入權限
  if (s.syncToken) data.token = s.syncToken;
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
  const token = local.token || remote.token;
  if (token) merged.token = token;

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
  if (data.token && !settings.get('syncToken')) {
    settings.patch({ syncToken: data.token }, { touch: false });
  }
}

/**
 * 新裝置接手：只要一組密語。
 * repo 從網址推導、檔案公開可讀、token 藏在加密內容裡，
 * 所以使用者只需要提供那個「只有他知道」的秘密。
 */
export async function restoreWithPassphrase(passphrase) {
  const pass = (passphrase || '').trim();
  if (!pass) throw new Error('請輸入同步密語。');

  const s = settings.all();
  const target = {
    syncRepo: s.syncRepo || guessRepo(),
    syncBranch: s.syncBranch,
    syncPath: s.syncPath,
  };
  if (!target.syncRepo) throw new Error('看不出這個 App 掛在哪個 repo，請改用 QR 配對。');

  const envelope = await readPublic(target);
  const data = await decryptJson(pass, envelope); // 密語不對會在這裡擋下來
  settings.patch({ ...target, syncPass: pass, syncEnabled: true });
  applyLocally(data);
  settings.patch({ syncLastAt: Date.now() }, { touch: false });
  return data;
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
