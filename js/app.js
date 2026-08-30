// JARVIS 主程式：畫面切換、人臉解鎖、語音對話。
import { settings, face as faceStore, pin as pinStore, chat as chatStore, wipeAll, migrate } from './store.js';
import * as fr from './face.js';
import * as voice from './voice.js';
import * as hud from './hud.js';
import * as ai from './ai.js';
import * as memory from './memory.js';
import * as sync from './sync.js';
import { randomPassphrase } from './crypto.js';

const APP_VERSION = '1.7.0';
const AUTO_LOCK_MS = 5 * 60 * 1000; // 離開 App 超過 5 分鐘就重新上鎖

const $ = (id) => document.getElementById(id);
const el = {};
[
  'screen-lock', 'screen-setup', 'screen-main', 'cam', 'reactor', 'rig', 'lock-status', 'lock-hint',
  'btn-scan', 'btn-use-pin', 'pin-pad', 'pin-input', 'btn-pin-ok',
  'setup-title', 'setup-sub', 'setup-name', 'enroll-cam', 'enroll-dots', 'enroll-tip', 'btn-enroll',
  'setup-pin', 'setup-pin2', 'setup-key', 'btn-setup-done', 'setup-hint', 'step-1', 'step-2', 'step-3', 'step-4',
  'chat', 'input', 'btn-send', 'btn-mic', 'btn-settings', 'btn-lock', 'btn-speak-toggle',
  'btn-handsfree', 'live-dot', 'greeting', 'vbars',
  'sheet', 'btn-sheet-close', 'set-name', 'set-assistant', 'set-persona', 'set-memory',
  'set-provider', 'set-key', 'set-workspace', 'set-gemini-key', 'set-proxy', 'set-model', 'set-effort',
  'rows-claude', 'rows-gemini', 'row-load-models', 'btn-load-models', 'set-auto-memory', 'set-tts', 'set-handsfree', 'set-voice',
  'set-sync-enabled', 'set-sync-repo', 'set-sync-path', 'set-sync-token', 'set-sync-pass',
  'set-sync-face', 'btn-sync-gen', 'btn-sync-now', 'btn-sync-copy', 'btn-sync-paste', 'sync-status',
  'set-rate', 'rate-val', 'set-threshold', 'thr-val', 'set-liveness',
  'btn-reenroll', 'btn-repin', 'btn-clear-chat', 'btn-wipe', 'sheet-version', 'toast',
  'btn-face-test', 'btn-face-test-stop', 'face-test', 'face-test-tip', 'test-cam',
  'probe-score', 'probe-verdict', 'probe-range',
].forEach((id) => { el[id] = $(id); });

const app = {
  history: [],
  client: null,
  busy: false,
  abort: null,
  listening: null,
  speaking: false,
  unlocked: false,
  scanning: false,
  hiddenAt: 0,
  setupMode: 'first', // first | reenroll | repin
  probing: false,
  probeSeen: null,
  enrolledThisRun: false,
};

// ── 小工具 ───────────────────────────────────────────────
let toastTimer;
function toast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function show(screen) {
  ['screen-lock', 'screen-setup', 'screen-main'].forEach((id) => {
    el[id].hidden = id !== screen;
  });
}

function hint(node, msg, isError = false) {
  node.textContent = msg || '';
  node.classList.toggle('err', !!isError);
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 13) return '午安';
  if (h < 18) return '午安';
  return '晚安';
}

// ── 對話畫面 ─────────────────────────────────────────────
function bubble(role, text, cls = '') {
  const div = document.createElement('div');
  div.className = `msg ${role} ${cls}`.trim();
  div.textContent = text;
  el.chat.appendChild(div);
  el.chat.scrollTop = el.chat.scrollHeight;
  return div;
}

function renderHistory() {
  el.chat.innerHTML = '';
  if (!app.history.length) {
    const s = settings.all();
    bubble('sys', `${timeGreeting()}${s.ownerName ? '，' + s.ownerName : ''}。${s.assistantName || 'JARVIS'} 已上線，隨時待命。`);
    return;
  }
  app.history.forEach((m) => bubble(m.role === 'user' ? 'me' : 'ai', m.text));
}

function setBusy(on) {
  app.busy = on;
  el['live-dot'].classList.toggle('busy', on);
  el['btn-send'].textContent = on ? '■' : '➤';
}

// ── 送出訊息 ─────────────────────────────────────────────
async function send(text) {
  const content = (text ?? el.input.value).trim();
  if (!content || app.busy) return;

  el.input.value = '';
  el.input.style.height = 'auto';
  voice.stopSpeaking();

  app.history.push({ role: 'user', text: content });
  bubble('me', content);
  chatStore.save(app.history);

  const node = bubble('ai', '', 'streaming');
  setBusy(true);
  app.abort = new AbortController();

  try {
    const s = settings.all();
    if (!app.client) app.client = ai.makeClient(s);
    const reply = await ai.ask({
      client: app.client,
      settings: s,
      history: app.history,
      signal: app.abort.signal,
      onDelta: (_d, full) => {
        node.textContent = memory.sanitizeStreaming(full);
        el.chat.scrollTop = el.chat.scrollHeight;
      },
    });
    node.classList.remove('streaming');

    const spoken = applyMemory(reply);
    node.textContent = spoken;

    if (!spoken.trim()) {
      node.remove();
      bubble('sys', '（沒有收到回覆）');
    } else {
      app.history.push({ role: 'assistant', text: spoken });
      chatStore.save(app.history);
      afterReply(spoken);
    }
  } catch (err) {
    node.remove();
    bubble('err', err.message || String(err));
    console.error(err);
  } finally {
    setBusy(false);
    app.abort = null;
  }
}

/**
 * 把助理寫在回覆裡的 <remember> / <forget> 收進長期記憶，
 * 回傳要顯示與朗讀的乾淨文字。
 */
function applyMemory(reply) {
  if (settings.get('autoMemory') === false) return memory.strip(reply);

  const { adds, removes, clean } = memory.extract(reply);
  if (!adds.length && !removes.length) return clean;

  const result = memory.merge(settings.get('memory'), { adds, removes });
  if (result.added.length || result.removed.length) {
    settings.patch({ memory: result.memory });
    sync.schedule(); // 新記到的事推到其他裝置
    const notes = [
      ...result.added.map((t) => `已記住：${t}`),
      ...result.removed.map((t) => `已忘記：${t}`),
    ];
    notes.forEach((n) => bubble('sys', n));
  }
  return clean;
}

/** 回覆完成後：朗讀，若開了免持就接著再聽 */
function afterReply(reply) {
  const s = settings.all();
  const continueListening = () => {
    if (settings.get('handsfree') && app.unlocked && !app.busy) {
      setTimeout(() => startListening(), 350);
    }
  };
  if (s.tts && voice.ttsSupported) {
    app.speaking = true;
    voice.speak(reply, {
      voiceURI: s.voiceURI,
      rate: s.rate,
      onEnd: () => { app.speaking = false; continueListening(); },
    });
  } else {
    continueListening();
  }
}

// ── 語音輸入 ─────────────────────────────────────────────
function startListening() {
  if (app.listening || app.busy) return;
  voice.stopSpeaking();
  app.speaking = false;
  el['btn-mic'].classList.add('rec');
  el['vbars'].hidden = false;
  el.input.placeholder = '聽你說…';

  app.listening = voice.listen({
    onPartial: (t) => { el.input.value = t; },
    onResult: (t) => { send(t); },
    onError: (err) => {
      toast(err.message);
      if (settings.get('handsfree')) {
        settings.patch({ handsfree: false }); // 避免麥克風失敗時無限重試
        syncHandsfreeUi();
      }
    },
    onEnd: () => {
      app.listening = null;
      el['btn-mic'].classList.remove('rec');
      el['vbars'].hidden = true;
      el.input.placeholder = '對 JARVIS 說點什麼…';
    },
  });
}

function stopListening() {
  app.listening?.stop();
}

function toggleMic() {
  if (app.listening) stopListening();
  else startListening();
}

function syncHandsfreeUi() {
  const on = !!settings.get('handsfree');
  el['btn-handsfree'].classList.toggle('off', !on);
  el['set-handsfree'].checked = on;
}

function syncTtsUi() {
  const on = !!settings.get('tts');
  el['btn-speak-toggle'].classList.toggle('off', !on);
  el['set-tts'].checked = on;
}

// ── 解鎖 / 上鎖 ──────────────────────────────────────────
function unlock() {
  app.unlocked = true;
  app.scanning = false;
  fr.stopCamera(el.cam);
  fr.stopCamera(el['enroll-cam']);
  el.reactor.classList.remove('scanning', 'matched');
  el.rig?.classList.remove('scanning', 'matched');
  app.history = chatStore.load();
  renderHistory();
  const s = settings.all();
  el.greeting.textContent = s.ownerName ? `· ${s.ownerName}` : '';
  syncTtsUi();
  syncHandsfreeUi();
  hud.setActive(false);
  show('screen-main');
  el['pin-pad'].hidden = true;
  el['pin-input'].value = '';
  if (settings.get('handsfree')) setTimeout(() => startListening(), 600);
  sync.schedule(1200); // 解鎖後先跟雲端對一次，拿到其他裝置的更新
}

function lock() {
  app.unlocked = false;
  app.scanning = false;
  stopProbe();
  stopListening();
  voice.stopSpeaking();
  app.abort?.abort();
  el.sheet.hidden = true;
  hint(el['lock-hint'], '');
  el['lock-status'].textContent = '系統待命中';
  el['pin-pad'].hidden = true;
  hud.recenter();
  hud.setActive(true);
  show('screen-lock');
}

async function runFaceUnlock() {
  if (app.scanning) return;
  voice.warmUp();       // 借這次點擊解開 iOS 的語音限制
  hud.enableMotion();   // 同一下手勢順便要動作感應權限，做傾斜視差

  if (!faceStore.exists()) {
    hint(el['lock-hint'], '這台裝置還沒有臉部檔案，請用密碼進入後到設定裡建檔。', true);
    return;
  }
  app.scanning = true;
  el['btn-scan'].disabled = true;
  el.reactor.classList.add('scanning');
  el.rig.classList.add('scanning');

  try {
    el['lock-status'].textContent = '啟動相機…';
    await fr.startCamera(el.cam);
    el['lock-status'].textContent = '載入辨識模型…';
    await fr.loadModels();

    const s = settings.all();
    const result = await fr.verify(el.cam, {
      threshold: s.threshold,
      liveness: s.liveness,
      onStatus: (m) => { el['lock-status'].textContent = m; },
      shouldStop: () => !app.scanning,
    });

    if (result.ok) {
      el.reactor.classList.add('matched');
      el.rig.classList.add('matched');
      el['lock-status'].textContent = '身分確認，歡迎回來。';
      setTimeout(unlock, 550);
      return;
    }
    const msgs = {
      'no-face': '沒偵測到人臉，光線夠嗎？',
      'no-match': '不是本人，請再試一次或改用密碼。',
      'no-enrollment': '尚未建立臉部檔案。',
      aborted: '已取消。',
    };
    el['lock-status'].textContent = '辨識未通過';
    hint(el['lock-hint'], msgs[result.reason] || '辨識失敗。', true);
  } catch (err) {
    console.error(err);
    el['lock-status'].textContent = '無法啟動辨識';
    hint(el['lock-hint'], cameraError(err), true);
  } finally {
    app.scanning = false;
    el['btn-scan'].disabled = false;
    el.reactor.classList.remove('scanning');
    el.rig.classList.remove('scanning');
    if (!app.unlocked) fr.stopCamera(el.cam);
  }
}

function cameraError(err) {
  const n = err?.name;
  if (n === 'NotAllowedError') return '相機權限被拒絕：iOS「設定 → Safari → 相機」要設為允許，或長按網址列重新允許。';
  if (n === 'NotFoundError') return '找不到前鏡頭。';
  if (n === 'NotReadableError') return '相機被其他 App 佔用了。';
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return '必須用 https 網址開啟才能使用相機。';
  }
  return err?.message || '未知錯誤。';
}

async function submitPin() {
  const value = el['pin-input'].value.trim();
  if (!value) return;
  if (await pinStore.verify(value)) {
    voice.warmUp();
    unlock();
  } else {
    hint(el['lock-hint'], '密碼不正確。', true);
    el['pin-input'].value = '';
  }
}

// ── 首次設定 / 重新建檔 ──────────────────────────────────
function paintDots(done, total) {
  el['enroll-dots'].innerHTML = '';
  for (let i = 0; i < total; i += 1) {
    const dot = document.createElement('i');
    if (i < done) dot.className = 'on';
    el['enroll-dots'].appendChild(dot);
  }
}

function openSetup(mode = 'first') {
  app.setupMode = mode;
  app.enrolledThisRun = false;
  const s = settings.all();
  el['setup-name'].value = s.ownerName || '';
  el['setup-key'].value = s.apiKey || '';
  el['setup-pin'].value = '';
  el['setup-pin2'].value = '';
  paintDots(0, 5);
  hint(el['setup-hint'], '');

  const onlyFace = mode === 'reenroll';
  const onlyPin = mode === 'repin';
  el['step-1'].hidden = onlyFace || onlyPin;
  el['step-3'].hidden = onlyFace;
  el['step-4'].hidden = onlyFace || onlyPin;
  el['step-2'].hidden = onlyPin;
  el['setup-title'].textContent = onlyFace ? '重新建立臉部檔案' : onlyPin ? '變更備用密碼' : '初始化 JARVIS';
  el['setup-sub'].textContent = onlyPin
    ? '設定一組新的備用密碼。'
    : '建立你的臉部特徵與備用密碼，資料只會留在這支裝置上。';
  el['btn-setup-done'].textContent = mode === 'first' ? '完成設定' : '儲存';
  el.sheet.hidden = true;
  show('screen-setup');
}

async function doEnroll() {
  el['btn-enroll'].disabled = true;
  try {
    hint(el['setup-hint'], '');
    el['enroll-tip'].textContent = '啟動相機…';
    await fr.startCamera(el['enroll-cam']);
    el['enroll-tip'].textContent = '載入辨識模型（第一次比較久）…';
    await fr.loadModels();
    paintDots(0, 5);
    await fr.enroll(el['enroll-cam'], {
      count: 5,
      onSample: (n, total) => paintDots(n, total),
      onStatus: (m) => { el['enroll-tip'].textContent = m; },
    });
    app.enrolledThisRun = true;
    const spread = fr.enrollmentSpread(faceStore.load().samples);
    if (spread > 0.32) {
      el['enroll-tip'].textContent = '建好了，但這幾張差異偏大，建議在光線更好的地方重拍一次。';
    } else {
      el['enroll-tip'].textContent = '臉部檔案已建立 ✔';
    }
    toast('臉部建檔完成');
  } catch (err) {
    console.error(err);
    el['enroll-tip'].textContent = '建檔失敗';
    hint(el['setup-hint'], cameraError(err), true);
  } finally {
    el['btn-enroll'].disabled = false;
    fr.stopCamera(el['enroll-cam']);
  }
}

async function finishSetup() {
  const mode = app.setupMode;
  const pinA = el['setup-pin'].value.trim();
  const pinB = el['setup-pin2'].value.trim();

  if (mode === 'reenroll') {
    if (!app.enrolledThisRun) { hint(el['setup-hint'], '請先完成臉部建檔。', true); return; }
    toast('臉部檔案已更新');
    unlock();
    return;
  }

  // 先確認臉部檔案，避免半途中止卻已經把密碼寫進去
  if (mode === 'first' && !app.enrolledThisRun && !faceStore.exists()) {
    hint(el['setup-hint'], '請先完成臉部建檔（也可先建檔再填其他欄位）。', true);
    return;
  }

  if (mode === 'repin' || mode === 'first') {
    const needPin = mode === 'repin' || !pinStore.exists();
    if (needPin || pinA || pinB) {
      if (pinA.length < 4) { hint(el['setup-hint'], '備用密碼至少 4 位。', true); return; }
      if (pinA !== pinB) { hint(el['setup-hint'], '兩次密碼不一樣。', true); return; }
      await pinStore.set(pinA);
    }
  }

  if (mode === 'repin') {
    toast('備用密碼已更新');
    unlock();
    return;
  }

  // 首次設定完成
  settings.patch({
    ownerName: el['setup-name'].value.trim(),
    apiKey: el['setup-key'].value.trim(),
  });
  app.client = null;
  unlock();
}

// ── 設定面板 ─────────────────────────────────────────────
function fillVoiceList() {
  const s = settings.all();
  const list = voice.listVoices();
  el['set-voice'].innerHTML = '';
  if (!list.length) {
    el['set-voice'].innerHTML = '<option value="">（系統預設）</option>';
    return;
  }
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = '自動選擇中文語音';
  el['set-voice'].appendChild(auto);
  list.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name}（${v.lang}）`;
    el['set-voice'].appendChild(opt);
  });
  el['set-voice'].value = s.voiceURI || '';
}

const SHEET_FIELDS = [
  // set-provider 不放進來：它有自己的處理順序（先換模型清單再存），
  // 否則通用的 change 監聽會搶先把上一家的模型寫進新一家的設定
  'set-name', 'set-assistant', 'set-persona', 'set-memory', 'set-key',
  'set-workspace', 'set-gemini-key', 'set-proxy', 'set-model', 'set-effort',
  'set-tts', 'set-handsfree', 'set-voice',
  'set-rate', 'set-threshold', 'set-liveness',
  'set-sync-enabled', 'set-sync-repo', 'set-sync-path', 'set-sync-token',
  'set-sync-pass', 'set-sync-face',
];

// ── 跨裝置同步 ───────────────────────────────────────────
function renderSyncStatus(extra) {
  const s = settings.all();
  if (extra) { el['sync-status'].textContent = extra; return; }
  if (!s.syncEnabled) { el['sync-status'].textContent = '同步關閉中'; return; }
  if (!sync.isConfigured(s)) { el['sync-status'].textContent = '還缺 repo、Token 或密語'; return; }
  el['sync-status'].textContent = s.syncLastAt
    ? `上次同步：${new Date(s.syncLastAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`
    : '已設定，還沒同步過';
}

async function syncNow(manual = false) {
  if (!sync.isConfigured()) {
    if (manual) toast('請先填好 repo、Token 與密語');
    return;
  }
  renderSyncStatus('同步中…');
  try {
    const r = await sync.syncNow();
    if (r.pulled) {
      // 雲端有比較新的資料，畫面上的設定要跟著更新
      if (!el.sheet.hidden) openSheet();
      const s = settings.all();
      el.greeting.textContent = s.ownerName ? `· ${s.ownerName}` : '';
      app.client = null;
    }
    renderSyncStatus();
    if (manual) toast(r.pulled ? '同步完成，已套用雲端的更新' : '同步完成');
  } catch (err) {
    renderSyncStatus(`同步失敗：${err.message}`);
    if (manual) toast(err.message);
  }
}

async function copyLinkCode() {
  saveFromSheet();
  if (!sync.isConfigured()) { toast('請先填好 repo、Token 與密語'); return; }
  const code = sync.makeLinkCode();
  try {
    await navigator.clipboard.writeText(code);
    toast('連結碼已複製，到另一台裝置貼上即可');
  } catch {
    // 有些情況拿不到剪貼簿權限，就直接顯示讓使用者自己複製
    el['set-sync-pass'].value = code;
    toast('無法自動複製，密語欄位已換成連結碼，請手動複製');
  }
}

async function pasteLinkCode() {
  let code = '';
  try {
    code = await navigator.clipboard.readText();
  } catch {
    code = prompt('貼上另一台裝置的連結碼：') || '';
  }
  if (!code.trim()) return;
  try {
    settings.patch({ ...sync.parseLinkCode(code), syncEnabled: true });
    openSheet();
    toast('連結碼已套用，開始同步…');
    await syncNow(true);
  } catch (err) {
    toast(err.message);
  }
}

// ── 供應商切換 ───────────────────────────────────────────
function fillModelList(models) {
  const s = settings.all();
  const key = el['set-provider'].value;
  const current = key === 'gemini' ? s.geminiModel : s.model;
  el['set-model'].innerHTML = '';
  let list = models || ai.PROVIDERS[key].models;
  // 目前選的模型不在清單裡（例如自訂或已下架）也要留著，不然會被靜靜換掉
  if (current && !list.some((m) => m.id === current)) {
    list = [...list, { id: current, label: `${current}（目前設定）` }];
  }
  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    el['set-model'].appendChild(opt);
  }
  el['set-model'].value = current || list[0]?.id || '';
}

function syncProviderUi() {
  const key = el['set-provider'].value;
  el['rows-claude'].hidden = key !== 'claude';
  el['rows-gemini'].hidden = key !== 'gemini';
  el['row-load-models'].hidden = key !== 'gemini';
  fillModelList();
}

async function loadModels() {
  const btn = el['btn-load-models'];
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '查詢中…';
  try {
    saveFromSheet();
    const models = await ai.listModels(settings.all());
    fillModelList(models);
    toast(`找到 ${models.length} 個可用模型`);
  } catch (err) {
    toast(err.message || '查詢失敗');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ── 辨識測試：實際量出鏡頭前這個人的分數 ──────────────────
function renderProbeRange() {
  const thr = +settings.get('threshold');
  const seen = app.probeSeen;
  el['probe-range'].textContent = seen
    ? `目前門檻 ${thr.toFixed(2)} · 這次測到的範圍 ${seen.min.toFixed(2)} ～ ${seen.max.toFixed(2)}`
    : `目前門檻 ${thr.toFixed(2)}：分數小於等於它就會解鎖`;
}

async function startProbe() {
  if (app.probing) return;
  if (!faceStore.exists()) { toast('還沒有臉部檔案，請先建檔。'); return; }
  app.probing = true;
  app.probeSeen = null;
  el['face-test'].hidden = false;
  el['btn-face-test'].hidden = true;
  el['probe-score'].textContent = '--';
  el['probe-verdict'].textContent = '啟動相機…';
  el['probe-verdict'].className = 'probe-verdict';
  renderProbeRange();

  try {
    await fr.startCamera(el['test-cam']);
    await fr.probe(el['test-cam'], {
      shouldStop: () => !app.probing,
      onTick: ({ found, score }) => {
        if (!found) {
          el['probe-score'].textContent = '--';
          el['probe-verdict'].textContent = '沒偵測到人臉';
          el['probe-verdict'].className = 'probe-verdict';
          return;
        }
        const thr = +settings.get('threshold');
        const pass = score <= thr;
        el['probe-score'].textContent = score.toFixed(2);
        el['probe-verdict'].textContent = pass ? '這個人會被放行 ✔' : '這個人會被擋下 ✘';
        el['probe-verdict'].className = `probe-verdict ${pass ? 'pass' : 'block'}`;
        app.probeSeen = app.probeSeen
          ? { min: Math.min(app.probeSeen.min, score), max: Math.max(app.probeSeen.max, score) }
          : { min: score, max: score };
        renderProbeRange();
      },
    });
  } catch (err) {
    console.error(err);
    el['probe-verdict'].textContent = cameraError(err);
    el['probe-verdict'].className = 'probe-verdict block';
  } finally {
    fr.stopCamera(el['test-cam']);
    app.probing = false;
    el['btn-face-test'].hidden = false;
  }
}

function stopProbe() {
  if (!app.probing) return;
  app.probing = false;
  fr.stopCamera(el['test-cam']);
  el['face-test'].hidden = true;
  el['btn-face-test'].hidden = false;
}

function closeSheet() {
  saveFromSheet();
  stopProbe();
  el.sheet.hidden = true;
}

function openSheet() {
  const s = settings.all();
  el['set-name'].value = s.ownerName;
  el['set-assistant'].value = s.assistantName;
  el['set-persona'].value = s.persona;
  el['set-memory'].value = s.memory;
  el['set-auto-memory'].checked = s.autoMemory !== false;
  el['set-provider'].value = ai.providerOf(s);
  el['set-key'].value = s.apiKey;
  el['set-workspace'].value = s.workspaceId;
  el['set-gemini-key'].value = s.geminiKey;
  el['set-proxy'].value = s.proxyUrl;
  el['set-effort'].value = s.effort;
  syncProviderUi();
  el['set-tts'].checked = s.tts;
  el['set-handsfree'].checked = s.handsfree;
  el['set-rate'].value = s.rate;
  el['rate-val'].textContent = `${(+s.rate).toFixed(2)}x`;
  el['set-threshold'].value = s.threshold;
  el['thr-val'].textContent = (+s.threshold).toFixed(2);
  el['set-liveness'].checked = s.liveness;
  el['set-sync-enabled'].checked = s.syncEnabled;
  el['set-sync-repo'].value = s.syncRepo;
  el['set-sync-path'].value = s.syncPath;
  el['set-sync-token'].value = s.syncToken;
  el['set-sync-pass'].value = s.syncPass;
  el['set-sync-face'].checked = s.syncFace !== false;
  renderSyncStatus();
  el['sheet-version'].textContent = `版本 ${APP_VERSION} · 資料僅存於本機`;
  fillVoiceList();
  el['face-test'].hidden = true;
  el['btn-face-test'].hidden = false;
  app.probeSeen = null;
  renderProbeRange();
  el.sheet.hidden = false;
}

function saveFromSheet() {
  settings.patch({
    ownerName: el['set-name'].value.trim(),
    assistantName: el['set-assistant'].value.trim() || 'JARVIS',
    persona: el['set-persona'].value,
    memory: el['set-memory'].value,
    autoMemory: el['set-auto-memory'].checked,
    provider: el['set-provider'].value,
    apiKey: el['set-key'].value.trim(),
    workspaceId: el['set-workspace'].value.trim(),
    geminiKey: el['set-gemini-key'].value.trim(),
    proxyUrl: el['set-proxy'].value.trim(),
    ...(el['set-provider'].value === 'gemini'
      ? { geminiModel: el['set-model'].value }
      : { model: el['set-model'].value }),
    effort: el['set-effort'].value,
    tts: el['set-tts'].checked,
    handsfree: el['set-handsfree'].checked,
    voiceURI: el['set-voice'].value,
    rate: +el['set-rate'].value,
    threshold: +el['set-threshold'].value,
    liveness: el['set-liveness'].checked,
    syncEnabled: el['set-sync-enabled'].checked,
    syncRepo: el['set-sync-repo'].value.trim(),
    syncPath: el['set-sync-path'].value.trim() || 'data.json',
    syncToken: el['set-sync-token'].value.trim(),
    syncPass: el['set-sync-pass'].value.trim(),
    syncFace: el['set-sync-face'].checked,
  });
  app.client = null; // 連線設定可能變了，下次重建
  el['rate-val'].textContent = `${(+el['set-rate'].value).toFixed(2)}x`;
  el['thr-val'].textContent = (+el['set-threshold'].value).toFixed(2);
  renderProbeRange();
  renderSyncStatus();
  sync.schedule(6000); // 設定改完一段時間沒再動，就推上去
  const s = settings.all();
  el.greeting.textContent = s.ownerName ? `· ${s.ownerName}` : '';
  syncTtsUi();
  syncHandsfreeUi();
}

// ── 事件綁定 ─────────────────────────────────────────────
function wire() {
  el['btn-scan'].addEventListener('click', runFaceUnlock);
  el['btn-use-pin'].addEventListener('click', () => {
    if (!pinStore.exists()) { hint(el['lock-hint'], '尚未設定備用密碼。', true); return; }
    el['pin-pad'].hidden = false;
    el['pin-input'].focus();
  });
  el['btn-pin-ok'].addEventListener('click', submitPin);
  el['pin-input'].addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPin(); });

  el['btn-enroll'].addEventListener('click', doEnroll);
  el['btn-setup-done'].addEventListener('click', finishSetup);

  el['btn-send'].addEventListener('click', () => {
    if (app.busy) { app.abort?.abort(); return; }
    send();
  });
  el['btn-mic'].addEventListener('click', toggleMic);
  el.input.addEventListener('input', () => {
    el.input.style.height = 'auto';
    el.input.style.height = `${Math.min(el.input.scrollHeight, 132)}px`;
  });
  el.input.addEventListener('keydown', (e) => {
    const isDesktop = !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (e.key === 'Enter' && !e.shiftKey && isDesktop) { e.preventDefault(); send(); }
  });

  el['btn-speak-toggle'].addEventListener('click', () => {
    const next = !settings.get('tts');
    settings.patch({ tts: next });
    if (!next) voice.stopSpeaking();
    syncTtsUi();
    toast(next ? '語音回覆已開啟' : '語音回覆已關閉');
  });
  el['btn-handsfree'].addEventListener('click', () => {
    const next = !settings.get('handsfree');
    settings.patch({ handsfree: next });
    syncHandsfreeUi();
    toast(next ? '免持連續對話：開（說完會自動再聽）' : '免持連續對話：關');
    if (next && !app.busy) startListening();
    else stopListening();
  });
  el['btn-lock'].addEventListener('click', lock);

  el['btn-settings'].addEventListener('click', openSheet);
  el['btn-sheet-close'].addEventListener('click', closeSheet);
  el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });
  // 每個欄位一改就立刻寫進 localStorage。先前只在關閉面板時才存，
  // iOS 若在中途把 App 回收，改過的設定就會退回原值。
  let saveTimer;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveFromSheet, 200); };
  SHEET_FIELDS.forEach((id) => {
    el[id].addEventListener('change', saveFromSheet);
    el[id].addEventListener('input', saveSoon);
  });
  el['set-voice'].addEventListener('change', () => {
    voice.speak('好的，這是我的聲音。', { voiceURI: el['set-voice'].value, rate: +el['set-rate'].value });
  });

  el['set-provider'].addEventListener('change', () => {
    // 順序很重要：先把供應商存好並換掉模型清單，再存整份設定。
    // 反過來的話，會把上一家的模型名稱寫進新一家的設定裡。
    settings.patch({ provider: el['set-provider'].value });
    syncProviderUi();
    saveFromSheet();
  });
  el['btn-load-models'].addEventListener('click', loadModels);
  el['btn-sync-gen'].addEventListener('click', () => {
    if (el['set-sync-pass'].value.trim()
      && !confirm('換掉密語之後，這台裝置就解不開雲端上現有的資料了。確定要產生新的嗎？')) return;
    el['set-sync-pass'].value = randomPassphrase();
    saveFromSheet();
    toast('新密語已產生，記得用「複製連結碼」帶到其他裝置');
  });
  el['btn-sync-now'].addEventListener('click', () => { saveFromSheet(); syncNow(true); });
  el['btn-sync-copy'].addEventListener('click', copyLinkCode);
  el['btn-sync-paste'].addEventListener('click', pasteLinkCode);

  el['btn-face-test'].addEventListener('click', startProbe);
  el['btn-face-test-stop'].addEventListener('click', stopProbe);

  el['btn-reenroll'].addEventListener('click', () => { closeSheet(); openSetup('reenroll'); });
  el['btn-repin'].addEventListener('click', () => { closeSheet(); openSetup('repin'); });
  el['btn-clear-chat'].addEventListener('click', () => {
    if (!confirm('確定清除所有對話紀錄？')) return;
    chatStore.clear();
    app.history = [];
    renderHistory();
    toast('對話已清除');
  });
  el['btn-wipe'].addEventListener('click', () => {
    if (!confirm('這會刪掉臉部檔案、密碼、金鑰與對話，確定嗎？')) return;
    wipeAll();
    location.reload();
  });

  // 切到背景太久就自動上鎖
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      app.hiddenAt = Date.now();
      stopListening();
      voice.stopSpeaking();
      if (app.scanning) { app.scanning = false; fr.stopCamera(el.cam); }
      stopProbe();
    } else if (app.unlocked && app.hiddenAt && Date.now() - app.hiddenAt > AUTO_LOCK_MS) {
      lock();
    } else if (app.unlocked) {
      sync.schedule(1500); // 回到前景時看看其他裝置有沒有新東西
    }
  });
  window.addEventListener('pagehide', () => {
    fr.stopCamera(el.cam);
    fr.stopCamera(el['enroll-cam']);
    fr.stopCamera(el['test-cam']);
  });
}

// ── 啟動 ─────────────────────────────────────────────────
function boot() {
  if (migrate()) console.info('設定已升級到新的比對方式');
  wire();
  hud.attach(el.rig);
  sync.setStatusHandler((r) => {
    if (!r.ok) { renderSyncStatus(`同步失敗：${r.message}`); return; }
    renderSyncStatus();
    if (r.pulled) {
      const s = settings.all();
      el.greeting.textContent = s.ownerName ? `· ${s.ownerName}` : '';
      app.client = null;
      if (!el.sheet.hidden) openSheet();
      toast('已從其他裝置同步到新資料');
    }
  });
  if (voice.ttsSupported) window.speechSynthesis.addEventListener?.('voiceschanged', fillVoiceList);

  if (!faceStore.exists() && !pinStore.exists()) {
    openSetup('first');
  } else {
    show('screen-lock');
    if (!faceStore.exists()) hint(el['lock-hint'], '尚未建立臉部檔案，請用密碼進入。');
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW 註冊失敗', err));
    });
  }
}

boot();
