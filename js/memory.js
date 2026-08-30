// 自動長期記憶：讓助理自己把值得記住的事寫進設定裡。
//
// 作法是請模型在回覆最後輸出 <remember>…</remember> / <forget>…</forget>，
// App 把標籤攔下來、寫進記憶、並從畫面與朗讀內容中拿掉。
// 這樣兩家供應商都能用同一套，也不用為了記憶多打一次 API。
const TAG_RE = /<(remember|forget)>([\s\S]*?)<\/\1>/gi;
const MAX_LINES = 40;
const MAX_CHARS = 2000;

/** 取出標籤內容，並回傳清乾淨的文字 */
export function extract(text) {
  const adds = [];
  const removes = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text)) !== null) {
    const value = m[2].replace(/\s+/g, ' ').trim();
    if (!value) continue;
    (m[1].toLowerCase() === 'remember' ? adds : removes).push(value);
  }
  return { adds, removes, clean: strip(text) };
}

export function strip(text) {
  return text
    .replace(TAG_RE, '')
    .replace(/<\/?(remember|forget)>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 串流途中用的：標籤可能只收到一半，先藏起來，
 * 不然使用者會看到 "<rememb" 這種東西閃過去。
 */
export function sanitizeStreaming(text) {
  let out = text.replace(TAG_RE, '');
  const i = out.lastIndexOf('<');
  if (i !== -1) {
    const tail = out.slice(i);
    if (/^<\/?[a-z]*$/i.test(tail) || /^<\/?(remember|forget)>/i.test(tail)) {
      out = out.slice(0, i);
    }
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

/** 把新記憶併進舊的，回傳實際變動的內容 */
export function merge(current, { adds, removes }) {
  let lines = (current || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const removed = [];
  const added = [];

  for (const r of removes) {
    const keep = lines.filter((l) => !l.toLowerCase().includes(r.toLowerCase()));
    if (keep.length !== lines.length) removed.push(r);
    lines = keep;
  }
  for (const a of adds) {
    const lower = a.toLowerCase();
    // 已經有一模一樣、或包含這句話的記錄就不重複寫
    if (lines.some((l) => l.toLowerCase() === lower || l.toLowerCase().includes(lower))) continue;
    // 反過來：新的比較完整，就取代舊的那筆
    lines = lines.filter((l) => !lower.includes(l.toLowerCase()));
    lines.push(a);
    added.push(a);
  }
  // 太多就從最舊的開始丟
  while (lines.length > MAX_LINES || lines.join('\n').length > MAX_CHARS) lines.shift();

  return { memory: lines.join('\n'), added, removed };
}
