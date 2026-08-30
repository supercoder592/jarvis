// 與 Claude 溝通：使用官方 Anthropic SDK（已打包成瀏覽器可直接載入的 ESM）。
import Anthropic from '../vendor/anthropic-sdk.esm.js';
import { buildSystemPrompt, recentTurns } from './prompt.js';

const MAX_TOKENS = 4096;

export function makeClient({ apiKey, proxyUrl, workspaceId }) {
  if (!apiKey && !proxyUrl) {
    throw new Error('還沒設定 API 金鑰。請點右上角 ⚙︎ 填入 Anthropic API 金鑰，或填你的 Proxy 網址。');
  }
  const opts = {
    // 這是「直接從瀏覽器呼叫」的必要旗標；SDK 會自動帶上
    // anthropic-dangerous-direct-browser-access 標頭。
    dangerouslyAllowBrowser: true,
    apiKey: apiKey || 'proxy',
    maxRetries: 1,
  };
  if (proxyUrl) opts.baseURL = proxyUrl.replace(/\/+$/, '');
  // 身分綁定（identity-linked）的金鑰必須指明這次請求要記在哪個 workspace
  if (workspaceId?.trim()) {
    opts.defaultHeaders = { 'anthropic-workspace-id': workspaceId.trim() };
  }
  return new Anthropic(opts);
}

/** 把畫面上的對話整理成 API 需要的格式 */
function toApiMessages(history) {
  return recentTurns(history).map((m) => ({ role: m.role, content: m.text }));
}

/**
 * 串流回覆。onDelta 會一段一段收到文字。
 * 回傳完整字串；被 abort 時回傳目前已收到的部分。
 */
export async function ask({ client, settings, history, onDelta, signal }) {
  const stream = client.beta.messages.stream(
    {
      model: settings.model || 'claude-opus-5',
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(settings),
      messages: toApiMessages(history),
      thinking: { type: 'adaptive' },
      output_config: { effort: settings.effort || 'low' },
      // 模型若因安全政策婉拒，由伺服器端自動改用替代模型再試一次
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );

  let text = '';
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text;
        onDelta?.(event.delta.text, text);
      }
    }
    const final = await stream.finalMessage();
    if (final?.stop_reason === 'refusal') {
      throw new Error('這個請求被安全機制擋下來了，換個方式問問看。');
    }
    if (final?.stop_reason === 'max_tokens') text += '…（回覆太長被截斷了）';
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return text;
    throw friendly(err);
  }
  return text;
}

function friendly(err) {
  const status = err?.status;
  if (status === 401) return new Error('API 金鑰無效或已失效，請到 ⚙︎ 重新輸入。');
  if (status === 403) return new Error('這把金鑰沒有權限使用這個模型。');
  if (status === 404) return new Error('找不到這個模型，請在設定裡換一個。');
  if (status === 429) return new Error('速率或額度用完了，等一下再試。');
  if (status === 400 && /workspace/i.test(err?.message || '')) {
    return new Error('這把金鑰是「身分綁定」型的，需要指定 workspace。'
      + '請到 ⚙︎ 設定的「Workspace ID」填入 wrkspc_... （在 Anthropic Console 的 Workspace 頁面網址裡），'
      + '或改用一把綁定 workspace 的一般金鑰。');
  }
  if (status === 400 && /credit|balance/i.test(err?.message || '')) {
    return new Error('帳戶餘額不足，請到 Anthropic Console 儲值。');
  }
  if (status >= 500) return new Error('Anthropic 伺服器忙線中，稍後再試。');
  if (err instanceof TypeError || /fetch|network|load failed/i.test(err?.message || '')) {
    return new Error('連線失敗：檢查網路，或改用 Proxy 網址（有些網路會擋 api.anthropic.com）。');
  }
  return err instanceof Error ? err : new Error(String(err));
}
