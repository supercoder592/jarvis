// 所有資料都放在這支裝置的 localStorage，不會離開手機（呼叫 Claude 時才會送出對話內容）。
const K = {
  settings: 'jarvis.settings',
  face: 'jarvis.face',
  pin: 'jarvis.pin',
  chat: 'jarvis.chat',
};

const DEFAULTS = {
  ownerName: '',
  assistantName: 'JARVIS',
  persona: '講話精簡自然，先講結論再補理由；語氣像沉穩可靠的私人管家，偶爾帶點幽默。',
  memory: '',
  apiKey: '',
  proxyUrl: '',
  workspaceId: '',
  model: 'claude-opus-5',
  effort: 'low',
  tts: true,
  handsfree: false,
  voiceURI: '',
  rate: 1.0,
  threshold: 0.38,
  liveness: false,
  schema: 2,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('儲存失敗', key, err);
    return false;
  }
}

export const settings = {
  all() {
    return { ...DEFAULTS, ...read(K.settings, {}) };
  },
  get(name) {
    return this.all()[name];
  },
  patch(partial) {
    const next = { ...this.all(), ...partial };
    write(K.settings, next);
    return next;
  },
};

/**
 * 舊版用「與最相近樣本的距離」判斷，v1.2 改成「與重心的距離」，
 * 兩者刻度不同，舊的門檻值套過來會過鬆，所以一次性重設成新的預設值。
 */
export function migrate() {
  const raw = read(K.settings, null);
  if (raw && (raw.schema || 0) < 2) {
    write(K.settings, { ...raw, threshold: DEFAULTS.threshold, schema: 2 });
    return true;
  }
  return false;
}

// ── 臉部特徵：存多組 128 維描述子，比對時算與重心的距離 ──
export const face = {
  load() {
    const data = read(K.face, null);
    if (!data || !Array.isArray(data.samples) || !data.samples.length) return null;
    return {
      enrolledAt: data.enrolledAt,
      samples: data.samples.map((s) => Float32Array.from(s)),
    };
  },
  save(descriptors) {
    return write(K.face, {
      enrolledAt: Date.now(),
      samples: descriptors.map((d) => Array.from(d, (n) => Math.round(n * 1e5) / 1e5)),
    });
  },
  clear() {
    localStorage.removeItem(K.face);
  },
  exists() {
    return !!this.load();
  },
};

// ── 備用密碼：只存 salt 與 SHA-256 雜湊，不存明碼 ──
const enc = new TextEncoder();

async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const pin = {
  exists() {
    return !!read(K.pin, null);
  },
  async set(value) {
    const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return write(K.pin, { salt, hash: await hashPin(value, salt) });
  },
  async verify(value) {
    const rec = read(K.pin, null);
    if (!rec) return false;
    return (await hashPin(value, rec.salt)) === rec.hash;
  },
  clear() {
    localStorage.removeItem(K.pin);
  },
};

// ── 對話紀錄：只留最近 MAX_TURNS 則 ──
const MAX_TURNS = 60;

export const chat = {
  load() {
    const list = read(K.chat, []);
    return Array.isArray(list) ? list : [];
  },
  save(messages) {
    write(K.chat, messages.slice(-MAX_TURNS));
  },
  clear() {
    localStorage.removeItem(K.chat);
  },
};

export function wipeAll() {
  Object.values(K).forEach((k) => localStorage.removeItem(k));
}
