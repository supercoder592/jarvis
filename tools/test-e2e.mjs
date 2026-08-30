/**
 * 端對端煙霧測試（用 Chromium 跑，不需要真的相機或 API 金鑰）。
 *
 *   npm i -D playwright && npx playwright install chromium
 *   （或用現成的瀏覽器：CHROMIUM_PATH=/path/to/chrome）
 *   node tools/test-e2e.mjs
 *
 * 驗證項目：模型能在瀏覽器載入、辨識流程可執行、設定精靈的檢查、
 * 密碼解鎖、串流對話渲染、設定儲存、Service Worker 註冊。
 * 人臉「認得出本人」這件事沒辦法在無相機環境測，請用實機確認。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8123;
const BASE = `http://localhost:${PORT}`;

const SSE = (text) => [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"claude-opus-5","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join('');

let pass = 0;
let fail = 0;
function check(label, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  ✔ ${label}${extra && ` — ${extra}`}`); }
  else { fail += 1; console.log(`  ✘ ${label}${extra && ` — ${extra}`}`); }
}

const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

// 想指定既有的 Chromium：CHROMIUM_PATH=/path/to/chrome node tools/test-e2e.mjs
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('**/v1/messages**', (route) => route.fulfill({
  status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE('晚安，我在。'),
}));

try {
  console.log('\n[1] 首次啟動與人臉模型');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('首次進入設定畫面', await page.isVisible('#screen-setup'));

  const models = await page.evaluate(async () => {
    const fr = await import('./js/face.js');
    await fr.loadModels();
    return {
      backend: faceapi.tf.getBackend(),
      all: faceapi.nets.tinyFaceDetector.isLoaded
        && faceapi.nets.faceLandmark68TinyNet.isLoaded
        && faceapi.nets.faceRecognitionNet.isLoaded,
    };
  });
  check('三個模型都載入成功', models.all, `backend=${models.backend}`);

  const detect = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    c.getContext('2d').fillRect(0, 0, 320, 240);
    await faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }))
      .withFaceLandmarks(true).withFaceDescriptor();
    return true;
  });
  check('偵測 + 特徵點 + 描述子流程可執行', detect);

  console.log('\n[2] 設定精靈的檢查');
  await page.fill('#setup-name', '老闆');
  await page.click('#btn-setup-done');
  check('沒建檔不給過', (await page.textContent('#setup-hint')).includes('臉部建檔'));
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.face.save([Float32Array.from({ length: 128 }, () => 0.2)]);
  });
  await page.fill('#setup-pin', '12'); await page.fill('#setup-pin2', '12');
  await page.click('#btn-setup-done');
  check('密碼太短不給過', (await page.textContent('#setup-hint')).includes('至少 4 位'));
  await page.fill('#setup-pin', '1234'); await page.fill('#setup-pin2', '4321');
  await page.click('#btn-setup-done');
  check('兩次密碼不同不給過', (await page.textContent('#setup-hint')).includes('不一樣'));
  await page.fill('#setup-pin2', '1234');
  await page.fill('#setup-key', 'sk-ant-test');
  await page.click('#btn-setup-done');
  await page.waitForSelector('#screen-main:not([hidden])', { timeout: 5000 });
  check('設定完成後進入主畫面', true);

  console.log('\n[3] 鎖定與解鎖');
  await page.click('#btn-lock');
  check('立即上鎖回到鎖定畫面', await page.isVisible('#screen-lock'));
  await page.click('#btn-use-pin');
  await page.fill('#pin-input', '9999'); await page.click('#btn-pin-ok');
  await page.waitForTimeout(250);
  check('錯誤密碼被擋下', await page.isVisible('#screen-lock'));
  await page.fill('#pin-input', '1234'); await page.click('#btn-pin-ok');
  await page.waitForSelector('#screen-main:not([hidden])', { timeout: 5000 });
  check('正確密碼可解鎖', true);

  console.log('\n[4] 對話');
  await page.evaluate(async () => { (await import('./js/store.js')).settings.patch({ tts: false }); });
  await page.fill('#input', '你在嗎？');
  await page.click('#btn-send');
  await page.waitForFunction(() => document.querySelectorAll('#chat .msg.ai').length > 0, { timeout: 10000 });
  check('AI 回覆有串流進畫面', (await page.textContent('#chat .msg.ai')).includes('我在'));
  check('對話有存進 localStorage',
    await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.chat')).length === 2));

  console.log('\n[5] 設定與離線');
  await page.click('#btn-settings');
  await page.waitForSelector('#sheet:not([hidden])');
  await page.fill('#set-persona', '像英國管家');
  await page.selectOption('#set-effort', 'medium');
  await page.click('#btn-sheet-close');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.settings')));
  check('設定有存起來', saved.persona === '像英國管家' && saved.effort === 'medium');
  const sw = await page.evaluate(async () => ({
    reg: !!(await navigator.serviceWorker.getRegistration()),
    caches: await caches.keys(),
  }));
  check('Service Worker 已註冊', sw.reg, sw.caches.join(', '));

  console.log(`\n主控台錯誤：${errors.length ? `\n  ${errors.join('\n  ')}` : '無'}`);
  if (errors.length) fail += 1;
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項。`);
process.exit(fail ? 1 : 0);
