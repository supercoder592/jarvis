// 兩家供應商共用的人格設定與對話整理。
const HISTORY_TURNS = 24; // 每次送出的最近對話則數

export function buildSystemPrompt(s) {
  const owner = s.ownerName?.trim() || '我';
  const name = s.assistantName?.trim() || 'JARVIS';
  const now = new Date().toLocaleString('zh-TW', {
    dateStyle: 'full', timeStyle: 'short', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const lines = [
    `你是 ${name}，${owner}的私人 AI 助理，跑在他手機主畫面上的一個 App 裡。`,
    `稱呼他「${owner}」。用繁體中文（台灣用語）回答。`,
    '',
    '回話原則：',
    '- 你的回覆常常會被語音朗讀出來，所以要口語、好聽、不要條列符號與 Markdown 記號，除非對方要求。',
    '- 預設簡短：一般問題兩三句話講完；對方要細節時才展開。',
    '- 先講結論，再補必要的理由。不確定就直說不確定，不要編。',
    '- 你沒有連網、沒有行事曆與郵件權限；遇到需要即時資料的問題，直說做不到並給替代方案。',
    '',
    `現在時間：${now}`,
  ];
  if (s.persona?.trim()) lines.push('', `${owner}希望你的風格：`, s.persona.trim());
  if (s.memory?.trim()) lines.push('', `關於${owner}（長期記憶，請自然運用、不要複述）：`, s.memory.trim());
  return lines.join('\n');
}

/** 取出最近幾則有效對話，格式 {role:'user'|'assistant', text} */
export function recentTurns(history) {
  return history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text?.trim())
    .slice(-HISTORY_TURNS);
}
