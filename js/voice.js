// 語音：Web Speech API。iOS Safari 需要先有使用者手勢才會發聲，
// 所以第一次解鎖時會呼叫 warmUp()。
const synth = window.speechSynthesis;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const ttsSupported = !!synth;
export const sttSupported = !!SR;

let voices = [];

function refreshVoices() {
  voices = synth ? synth.getVoices() : [];
  return voices;
}

if (synth) {
  refreshVoices();
  synth.addEventListener?.('voiceschanged', refreshVoices);
}

export function listVoices() {
  if (!voices.length) refreshVoices();
  // 中文語音排前面
  return [...voices].sort((a, b) => {
    const score = (v) => (/^zh/i.test(v.lang) ? 0 : 1);
    return score(a) - score(b) || a.name.localeCompare(b.name);
  });
}

function pickVoice(voiceURI) {
  if (!voices.length) refreshVoices();
  return (
    voices.find((v) => v.voiceURI === voiceURI) ||
    voices.find((v) => /^zh[-_]TW/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    voices[0] ||
    null
  );
}

/** 在使用者手勢中呼叫一次，解開 iOS 的自動播放限制 */
export function warmUp() {
  if (!synth) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
    refreshVoices();
  } catch { /* 忽略 */ }
}

export function stopSpeaking() {
  try { synth?.cancel(); } catch { /* 忽略 */ }
}

// iOS 對過長的句子容易中斷，切成段落逐句念
function chunk(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '（程式碼略過）')
    .replace(/[*_#>`]/g, '')
    .trim();
  const parts = clean.split(/(?<=[。！？!?；;\n])/);
  const out = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + p).length > 140) {
      if (buf) out.push(buf);
      buf = p;
    } else buf += p;
  }
  if (buf.trim()) out.push(buf);
  return out.filter((s) => s.trim());
}

export function speak(text, { voiceURI, rate = 1, onEnd } = {}) {
  if (!synth || !text?.trim()) { onEnd?.(); return; }
  stopSpeaking();
  const pieces = chunk(text);
  const voice = pickVoice(voiceURI);
  pieces.forEach((piece, i) => {
    const u = new SpeechSynthesisUtterance(piece);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    else u.lang = 'zh-TW';
    u.rate = rate;
    u.pitch = 1;
    if (i === pieces.length - 1) {
      u.onend = () => onEnd?.();
      u.onerror = () => onEnd?.();
    }
    synth.speak(u);
  });
}

/** 語音輸入。回傳一個可 stop() 的控制物件。 */
export function listen({ onPartial, onResult, onError, onEnd } = {}) {
  if (!SR) {
    onError?.(new Error('這台裝置的瀏覽器不支援語音輸入，請改用鍵盤。'));
    onEnd?.();
    return { stop() {} };
  }
  const rec = new SR();
  rec.lang = 'zh-TW';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) onPartial?.(interim);
  };
  rec.onerror = (e) => {
    const map = {
      'not-allowed': '麥克風權限被拒絕，請到「設定 → Safari → 麥克風」開啟。',
      'service-not-allowed': '這個環境不允許語音輸入，請改用鍵盤。',
      'no-speech': '沒有聽到聲音。',
      'audio-capture': '找不到麥克風。',
    };
    onError?.(new Error(map[e.error] || `語音輸入失敗：${e.error}`));
  };
  rec.onend = () => {
    if (finalText.trim()) onResult?.(finalText.trim());
    onEnd?.();
  };

  try {
    rec.start();
  } catch (err) {
    onError?.(err);
    onEnd?.();
  }
  return { stop() { try { rec.stop(); } catch { /* 忽略 */ } } };
}
