/**
 * 選用：Cloudflare Worker 代理。
 * 好處是 Anthropic API 金鑰放在伺服器端，手機上不留金鑰。
 *
 * 部署：
 *   npm i -g wrangler
 *   cd worker && wrangler secret put ANTHROPIC_API_KEY && wrangler deploy
 * 然後在 App 的 ⚙︎ 設定裡，把「Proxy 網址」填成 Worker 的網址，金鑰欄位留空。
 */
const ALLOWED_PATHS = /^\/v1\/(messages|models)/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';

    // 只放行你自己的 App 網域（強烈建議設定 ALLOWED_ORIGIN）
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
      return new Response('Forbidden origin', { status: 403 });
    }
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.test(url.pathname)) {
      return cors(new Response('Not found', { status: 404 }), origin);
    }

    const headers = new Headers(request.headers);
    headers.set('x-api-key', env.ANTHROPIC_API_KEY);
    headers.delete('authorization');
    headers.delete('origin');
    headers.delete('referer');
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');

    const upstream = await fetch(`https://api.anthropic.com${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : request.body,
    });

    // 串流回應直接透傳
    return cors(new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    }), origin);
  },
};

function cors(res, origin) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', origin);
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', '*');
  r.headers.set('Access-Control-Max-Age', '86400');
  return r;
}
