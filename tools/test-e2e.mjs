/**
 * 端對端煙霧測試（用 Chromium 跑，不需要真的相機或 API 金鑰）。
 *
 *   npm i -D playwright && npx playwright install chromium
 *   （或用現成的瀏覽器：CHROMIUM_PATH=/path/to/chrome）
 *   node tools/test-e2e.mjs
 *
 * 驗證項目：模型能在瀏覽器載入、辨識流程可執行、設定精靈的檢查、密碼解鎖、
 * 兩家供應商的串流對話、設定儲存、Service Worker 註冊。
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
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // 同步第一次一定會對還不存在的檔案拿到 404，那是預期行為不是錯誤
  if ((m.location()?.url || '').includes('api.github.com')) return;
  errors.push(m.text());
});
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

  console.log('\n[5] 切換到 Gemini');
  let geminiBody = null;
  await page.route('**/generativelanguage.googleapis.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/models')) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ models: [
          { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ] }) });
    }
    geminiBody = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' },
      // 用 \r\n\r\n：Google 實際送的就是這個，只認 \n\n 會解析不出來
      body: 'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"(思考)"},{"text":"我在。<remember>生日是 3 月 14 日</remember>"}],"role":"model"},"finishReason":"STOP"}]}\r\n\r\n' });
  });
  await page.click('#btn-settings');
  await page.waitForSelector('#sheet:not([hidden])');
  await page.selectOption('#set-provider', 'gemini');
  await page.waitForTimeout(200);
  check('切換後只顯示 Gemini 欄位',
    await page.isVisible('#rows-gemini') && await page.isHidden('#rows-claude'));
  const geminiOpts = await page.$$eval('#set-model option', (o) => o.map((x) => x.value));
  check('模型清單換成 Gemini', geminiOpts.every((v) => v.startsWith('gemini')), geminiOpts.join(', '));
  await page.fill('#set-gemini-key', 'AIzaTEST');
  await page.click('#btn-load-models');
  await page.waitForTimeout(500);
  const listed = await page.$$eval('#set-model option', (o) => o.map((x) => x.value));
  check('線上查詢模型並濾掉 embedding', listed.length === 1 && listed[0] === 'gemini-flash-latest');
  await page.click('#btn-sheet-close');
  await page.fill('#input', '你在嗎？');
  await page.click('#btn-send');
  await page.waitForFunction(() => document.querySelectorAll('#chat .msg.ai').length > 1, { timeout: 10000 });
  const geminiReply = await page.$$eval('#chat .msg.ai', (n) => n[n.length - 1].textContent);
  check('Gemini 回覆進畫面且略過 thought 與記憶標籤', geminiReply === '我在。', geminiReply);
  const memText = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.settings')).memory);
  check('助理自己寫進長期記憶', memText.includes('生日是 3 月 14 日'), memText);
  check('畫面上有提示記住了什麼',
    await page.$$eval('#chat .msg.sys', (n) => n.some((e) => e.textContent.includes('已記住'))));
  check('送出的 body 結構正確',
    !!geminiBody?.systemInstruction?.parts?.[0]?.text && geminiBody.contents.at(-1).role === 'user');
  await page.click('#btn-settings');
  await page.selectOption('#set-provider', 'claude');
  await page.waitForTimeout(200);
  const backOpts = await page.$$eval('#set-model option', (o) => o.map((x) => x.value));
  check('切回 Claude 的清單沒被污染', backOpts.every((v) => v.startsWith('claude')), backOpts.join(', '));
  await page.click('#btn-sheet-close');

  console.log('\n[6] 設定與離線');
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

  console.log('\n[7] 跨裝置同步');
  let ghStore = null;
  let ghPuts = 0;
  let ghBranch = false;
  await page.route('**/api.github.com/**', (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const send = (status, body) => route.fulfill({
      status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    // 同步檔放在獨立分支，第一次寫入前會先確認／建立分支
    if (pathname.endsWith('/git/ref/heads/jarvis-data')) {
      return ghBranch ? send(200, { object: { sha: 'x' } }) : send(404, { message: 'Not Found' });
    }
    if (pathname.includes('/git/ref/heads/')) return send(200, { object: { sha: 'base' } });
    if (pathname.endsWith('/git/refs')) { ghBranch = true; return send(201, {}); }
    if (!pathname.includes('/contents/')) return send(200, { default_branch: 'main' });

    if (req.method() === 'GET') return ghStore ? send(200, ghStore) : send(404, { message: 'Not Found' });
    ghPuts += 1;
    const body = JSON.parse(req.postData());
    if (body.branch !== 'jarvis-data') return send(400, { message: `寫錯分支：${body.branch}` });
    if (ghStore && body.sha !== ghStore.sha) return send(409, { message: 'conflict' });
    ghStore = { content: body.content, sha: `sha${ghPuts}` };
    return send(200, {});
  });
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.settings.patch({ memory: '住在台北', syncRepo: 'me/jarvis-data', syncToken: 'ghp_TEST', syncEnabled: true });
    const { randomPassphrase } = await import('./js/crypto.js');
    s.settings.patch({ syncPass: randomPassphrase() });
  });
  const link = await page.evaluate(async () => {
    await (await import('./js/sync.js')).syncNow();
    return (await import('./js/sync.js')).makeLinkCode();
  });
  const raw = Buffer.from(ghStore.content, 'base64').toString('utf8');
  check('上傳的是密文，看不到明文記憶', !raw.includes('住在台北'), Object.keys(JSON.parse(raw)).join(','));

  // 換一台「新裝置」：清空本機資料，只用連結碼接回來
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  const restored = await page.evaluate(async (code) => {
    const s = await import('./js/store.js');
    const sync = await import('./js/sync.js');
    s.settings.patch({ ...sync.parseLinkCode(code), syncEnabled: true });
    await sync.syncNow();
    return { memory: s.settings.get('memory'), face: s.face.exists() };
  }, link);
  check('新裝置用連結碼還原記憶與臉部檔案', restored.memory === '住在台北' && restored.face,
    `memory=${restored.memory} face=${restored.face}`);
  check('同步檔寫在獨立分支，不會動到 Pages 的 main', ghBranch);
  const wrongPass = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.settings.patch({ syncPass: 'WRONG-PASS' });
    try { await (await import('./js/sync.js')).syncNow(); return ''; } catch (e) { return e.message; }
  });
  check('密語不對會擋下來', wrongPass.includes('密語'), wrongPass);

  console.log(`\n主控台錯誤：${errors.length ? `\n  ${errors.join('\n  ')}` : '無'}`);
  if (errors.length) fail += 1;
} finally {
  await browser.close();
  server.kill();
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項。`);
process.exit(fail ? 1 : 0);
