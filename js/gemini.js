// Google Gemini（Generative Language API）。有免費額度，適合日常閒聊。
// 直接用 REST + SSE，不額外載入 SDK，讓 App 保持輕量。
import { buildSystemPrompt, recentTurns } from './prompt.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_TOKENS = 2048;

// 有些模型不吃 thinkingLevel，被退件一次之後就不再送
let thinkingSupported = true;

export const FALLBACK_MODELS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash（最新，免費額度友善）' },
  { id: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite（最快最省）' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro（最聰明，額度較緊）' },
];

export function makeClient({ geminiKey }) {
  const key = geminiKey?.trim();
  if (!key) {
    throw new Error('還沒設定 Gemini API 金鑰。請點右上角 ⚙︎ 填入，可到 aistudio.google.com/apikey 免費申請。');
  }
  return { key };
}

function toContents(history) {
  return recentTurns(history).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));
}

function buildBody(settings, history, withThinking) {
  const body = {
    systemInstruction: { parts: [{ text: buildSystemPrompt(settings) }] },
    contents: toContents(history),
    generationConfig: { maxOutputTokens: MAX_TOKENS },
  };
  if (withThinking) {
    // low / medium / high 直接對應 Gemini 的 thinkingLevel
    body.generationConfig.thinkingConfig = { thinkingLevel: settings.effort || 'low' };
  }
  return body;
}

export async function ask({ client, settings, history, onDelta, signal }) {
  const model = settings.geminiModel || FALLBACK_MODELS[0].id;
  let res = await send(client, model, buildBody(settings, history, thinkingSupported), signal);

  // 模型不支援 thinkingLevel 就退一步重送，之後都不再帶
  if (!res.ok && res.status === 400 && thinkingSupported) {
    const text = await res.clone().text().catch(() => '');
    if (/thinking/i.test(text)) {
      thinkingSupported = false;
      res = await send(client, model, buildBody(settings, history, false), signal);
    }
  }
  if (!res.ok) throw await friendly(res);
  return readStream(res, onDelta, signal);
}

const IDLE_TIMEOUT_MS = 45000;

async function send(client, model, body, signal) {
  try {
    return await fetch(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': client.key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(`連不上 Gemini（${err?.message || err}）。檢查網路，或稍後再試。`);
  }
}

const BLOCK_REASONS = {
  SAFETY: '這個回覆被 Gemini 的安全機制擋下來了，換個說法試試。',
  RECITATION: '回覆因為疑似引用受版權保護的內容而被中斷。',
  PROHIBITED_CONTENT: '這個請求被 Gemini 判定為不允許的內容。',
};

// Google 的 SSE 用 \r\n\r\n 分隔事件，不是只有 \n\n。
// 只認 \n\n 的話資料永遠湊不成一個事件，請求會一直卡住直到連線斷掉。
const DELIMITERS = ['\r\n\r\n', '\n\n', '\r\r'];

/** 串流中途收到的 API 錯誤，要原樣往外丟，不要被當成連線中斷 */
class StreamError extends Error {}

function findDelimiter(buffer) {
  let at = -1;
  let len = 0;
  for (const d of DELIMITERS) {
    const i = buffer.indexOf(d);
    if (i !== -1 && (at === -1 || i < at)) { at = i; len = d.length; }
  }
  return at === -1 ? null : { at, len };
}

async function readStream(res, onDelta, signal) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Gemini 沒有回傳內容。');
  const decoder = new TextDecoder('utf-8');
  const state = { text: '', blocked: null };
  let buffer = '';

  // 閒置太久就收手，避免整個介面卡住不動
  let idle;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => reader.cancel().catch(() => {}), IDLE_TIMEOUT_MS);
  };

  try {
    resetIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });

      let hit;
      while ((hit = findDelimiter(buffer))) {
        const block = buffer.slice(0, hit.at);
        buffer = buffer.slice(hit.at + hit.len);
        handleBlock(block, state, onDelta);
      }
    }
    if (buffer.trim()) handleBlock(buffer, state, onDelta); // 最後一段沒有結尾分隔符
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return state.text;
    if (err instanceof StreamError) throw err;
    if (state.text) return state.text; // 已經收到一部分就先給使用者
    throw new Error(`回覆傳到一半中斷了（${err?.message || err}）。`);
  } finally {
    clearTimeout(idle);
  }

  if (!state.text.trim() && state.blocked) throw new Error(state.blocked);
  return state.text;
}

function handleBlock(block, state, onDelta) {
  for (const line of block.split(/\r\n|\n|\r/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let json;
    try { json = JSON.parse(payload); } catch { continue; }

    // 錯誤也可能包在串流中間送過來
    if (json.error) {
      throw new StreamError(json.error.message
        || `Gemini 回報錯誤（${json.error.status || json.error.code}）。`);
    }
    if (json.promptFeedback?.blockReason) {
      state.blocked = BLOCK_REASONS[json.promptFeedback.blockReason]
        || `請求被擋下（${json.promptFeedback.blockReason}）。`;
    }
    const cand = json.candidates?.[0];
    for (const part of cand?.content?.parts || []) {
      if (part.thought || typeof part.text !== 'string') continue;
      state.text += part.text;
      onDelta?.(part.text, state.text);
    }
    const finish = cand?.finishReason;
    if (finish && finish !== 'STOP') {
      if (finish === 'MAX_TOKENS') state.text += '…（回覆太長被截斷了）';
      else state.blocked = BLOCK_REASONS[finish] || `回覆提前結束（${finish}）。`;
    }
  }
}

async function friendly(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch { /* 忽略 */ }

  if (res.status === 400 && /API key not valid/i.test(detail)) {
    return new Error('Gemini 金鑰無效，請到 ⚙︎ 重新貼一次。');
  }
  if (res.status === 401 || res.status === 403) {
    return new Error('Gemini 金鑰沒有權限，或這個地區/專案未開通這個模型。');
  }
  if (res.status === 404) {
    return new Error('找不到這個 Gemini 模型，請到 ⚙︎ 按「載入可用模型」重選一個。');
  }
  if (res.status === 429) {
    return new Error('免費額度的用量上限到了（每分鐘或每日）。等幾分鐘再試，或換 Flash Lite 這種較省的模型。');
  }
  if (res.status >= 500) return new Error('Gemini 伺服器忙線中，稍後再試。');
  return new Error(detail || `Gemini 回應錯誤（${res.status}）。`);
}

/** 用金鑰去問「這把金鑰現在能用哪些模型」，避免模型名稱過時 */
export async function listModels({ geminiKey }) {
  const key = geminiKey?.trim();
  if (!key) throw new Error('請先填入 Gemini 金鑰。');

  const out = [];
  let pageToken = '';
  for (let page = 0; page < 4; page += 1) {
    const url = `${BASE}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw await friendly(res);
    const data = await res.json();
    for (const m of data.models || []) {
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
      const id = (m.name || '').replace(/^models\//, '');
      if (!id || /embedding|aqa|imagen|veo|tts/i.test(id)) continue;
      out.push({ id, label: m.displayName ? `${m.displayName}（${id}）` : id });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  // 對話用的排前面
  out.sort((a, b) => Number(/flash/i.test(b.id)) - Number(/flash/i.test(a.id)) || a.id.localeCompare(b.id));
  return out.length ? out : FALLBACK_MODELS;
}
