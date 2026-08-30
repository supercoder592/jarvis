// JARVIS 主程式：畫面切換、人臉解鎖、語音對話。
import { settings, face as faceStore, pin as pinStore, chat as chatStore, wipeAll } from './store.js';
import * as fr from './face.js';
import * as voice from './voice.js';
import { makeClient, ask } from './claude.js';

const APP_VERSION = '1.0.0';
const AUTO_LOCK_MS = 5 * 60 * 1000; // 離開 App 超過 5 分鐘就重新上鎖

const $ = (id) => document.getElementById(id);
const el = {};
[
  'screen-lock', 'screen-setup', 'screen-main', 'cam', 'reactor', 'lock-status', 'lock-hint',
  'btn-scan', 'btn-use-pin', 'pin-pad', 'pin-input', 'btn-pin-ok',
  'setup-title', 'setup-sub', 'setup-name', 'enroll-cam', 'enroll-dots', 'enroll-tip', 'btn-enroll',
  'setup-pin', 'setup-pin2', 'setup-key', 'btn-setup-done', 'setup-hint', 'step-1', 'step-2', 'step-3', 'step-4',
  'chat', 'input', 'btn-send', 'btn-mic', 'btn-settings', 'btn-lock', 'btn-speak-toggle',
  'btn-handsfree', 'live-dot', 'greeting',
  'sheet', 'btn-sheet-close', 'set-name', 'set-assistant', 'set-persona', 'set-memory',
  'set-key', 'set-proxy', 'set-model', 'set-effort', 'set-tts', 'set-handsfree', 'set-voice',
  'set-rate', 'rate-val', 'set-threshold', 'thr-val', 'set-liveness',
  'btn-reenroll', 'btn-repin', 'btn-clear-chat', 'btn-wipe', 'sheet-version', 'toast',
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
    if (!app.client) app.client = makeClient(s);
    const reply = await ask({
      client: app.client,
      settings: s,
      history: app.history,
      signal: app.abort.signal,
      onDelta: (_d, full) => {
        node.textContent = full;
        el.chat.scrollTop = el.chat.scrollHeight;
      },
    });
    node.classList.remove('streaming');

    if (!reply.trim()) {
      node.remove();
      bubble('sys', '（沒有收到回覆）');
    } else {
      app.history.push({ role: 'assistant', text: reply });
      chatStore.save(app.history);
      afterReply(reply);
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
  app.history = chatStore.load();
  renderHistory();
  const s = settings.all();
  el.greeting.textContent = s.ownerName ? `· ${s.ownerName}` : '';
  syncTtsUi();
  syncHandsfreeUi();
  show('screen-main');
  el['pin-pad'].hidden = true;
  el['pin-input'].value = '';
  if (settings.get('handsfree')) setTimeout(() => startListening(), 600);
}

function lock() {
  app.unlocked = false;
  app.scanning = false;
  stopListening();
  voice.stopSpeaking();
  app.abort?.abort();
  el.sheet.hidden = true;
  hint(el['lock-hint'], '');
  el['lock-status'].textContent = '系統待命中';
  el['pin-pad'].hidden = true;
  show('screen-lock');
}

async function runFaceUnlock() {
  if (app.scanning) return;
  voice.warmUp(); // 借這次點擊解開 iOS 的語音限制

  if (!faceStore.exists()) {
    hint(el['lock-hint'], '這台裝置還沒有臉部檔案，請用密碼進入後到設定裡建檔。', true);
    return;
  }
  app.scanning = true;
  el['btn-scan'].disabled = true;
  el.reactor.classList.add('scanning');

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
    el['enroll-tip'].textContent = '臉部檔案已建立 ✔';
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

function openSheet() {
  const s = settings.all();
  el['set-name'].value = s.ownerName;
  el['set-assistant'].value = s.assistantName;
  el['set-persona'].value = s.persona;
  el['set-memory'].value = s.memory;
  el['set-key'].value = s.apiKey;
  el['set-proxy'].value = s.proxyUrl;
  el['set-model'].value = s.model;
  el['set-effort'].value = s.effort;
  el['set-tts'].checked = s.tts;
  el['set-handsfree'].checked = s.handsfree;
  el['set-rate'].value = s.rate;
  el['rate-val'].textContent = `${(+s.rate).toFixed(2)}x`;
  el['set-threshold'].value = s.threshold;
  el['thr-val'].textContent = (+s.threshold).toFixed(2);
  el['set-liveness'].checked = s.liveness;
  el['sheet-version'].textContent = `版本 ${APP_VERSION} · 資料僅存於本機`;
  fillVoiceList();
  el.sheet.hidden = false;
}

function saveFromSheet() {
  settings.patch({
    ownerName: el['set-name'].value.trim(),
    assistantName: el['set-assistant'].value.trim() || 'JARVIS',
    persona: el['set-persona'].value,
    memory: el['set-memory'].value,
    apiKey: el['set-key'].value.trim(),
    proxyUrl: el['set-proxy'].value.trim(),
    model: el['set-model'].value,
    effort: el['set-effort'].value,
    tts: el['set-tts'].checked,
    handsfree: el['set-handsfree'].checked,
    voiceURI: el['set-voice'].value,
    rate: +el['set-rate'].value,
    threshold: +el['set-threshold'].value,
    liveness: el['set-liveness'].checked,
  });
  app.client = null; // 連線設定可能變了，下次重建
  el['rate-val'].textContent = `${(+el['set-rate'].value).toFixed(2)}x`;
  el['thr-val'].textContent = (+el['set-threshold'].value).toFixed(2);
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
  el['btn-sheet-close'].addEventListener('click', () => { saveFromSheet(); el.sheet.hidden = true; });
  el.sheet.addEventListener('click', (e) => {
    if (e.target === el.sheet) { saveFromSheet(); el.sheet.hidden = true; }
  });
  ['set-rate', 'set-threshold'].forEach((id) => {
    el[id].addEventListener('input', () => {
      el['rate-val'].textContent = `${(+el['set-rate'].value).toFixed(2)}x`;
      el['thr-val'].textContent = (+el['set-threshold'].value).toFixed(2);
    });
  });
  el['set-voice'].addEventListener('change', () => {
    saveFromSheet();
    voice.speak('好的，這是我的聲音。', { voiceURI: el['set-voice'].value, rate: +el['set-rate'].value });
  });

  el['btn-reenroll'].addEventListener('click', () => { saveFromSheet(); openSetup('reenroll'); });
  el['btn-repin'].addEventListener('click', () => { saveFromSheet(); openSetup('repin'); });
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
    } else if (app.unlocked && app.hiddenAt && Date.now() - app.hiddenAt > AUTO_LOCK_MS) {
      lock();
    }
  });
  window.addEventListener('pagehide', () => {
    fr.stopCamera(el.cam);
    fr.stopCamera(el['enroll-cam']);
  });
}

// ── 啟動 ─────────────────────────────────────────────────
function boot() {
  wire();
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
