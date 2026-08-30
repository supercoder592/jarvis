// 兩家供應商共用的人格設定與對話整理。
const HISTORY_TURNS = 24; // 每次送出的最近對話則數

// 自動記憶：用標籤讓助理自己寫進長期記憶，App 會攔下來、不會顯示給使用者
const MEMORY_RULES = [
  '你可以自己更新長期記憶：',
  '- 對話中出現值得長期記住的事（稱呼、家人、住處、工作、學校、重要日期、'
    + '喜好與討厭的東西、慣用工具、正在進行的事…），就在回覆的最後另起一行，',
  '  寫成 <remember>一句話的事實</remember>。有好幾件就寫好幾行。',
  '- 對方要你忘掉某件事時，寫 <forget>要忘掉的關鍵字</forget>。',
  '- 每則記憶寫成獨立、以後看得懂的一句話，例如「生日是 3 月 14 日」而不是「今天」。',
  '- 只記之後真的會用到的事實。閒聊、一次性的問題、你自己的回答都不要記。',
  '- 已經在長期記憶裡的事就不要重複寫。',
  '- 這些標籤會被 App 攔下來，對方看不到，所以回覆本身要完整通順，也不要提起標籤這件事。',
].join('\n');

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
    `- 你對${owner}的了解，只有下面「長期記憶」裡寫的東西。沒寫的就是你不知道，`
      + '不要猜、不要說「根據系統記錄」這種話。直接說你還不知道，並問他要不要告訴你。',
    '',
    `現在時間：${now}`,
  ];
  if (s.persona?.trim()) lines.push('', `${owner}希望你的風格：`, s.persona.trim());

  lines.push('', `關於${owner}（長期記憶，請自然運用、不要整段複述）：`);
  lines.push(s.memory?.trim() || '（目前是空的，你還不認識他）');

  if (s.autoMemory !== false) lines.push('', MEMORY_RULES);
  return lines.join('\n');
}

/** 取出最近幾則有效對話，格式 {role:'user'|'assistant', text} */
export function recentTurns(history) {
  return history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text?.trim())
    .slice(-HISTORY_TURNS);
}
