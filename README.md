# JARVIS — 你自己的個人 AI 助理

一個裝在 iPhone 主畫面上的私人助理：**人臉辨識解鎖**、**語音對話**、離線也打得開。
純前端 PWA，沒有後端、沒有帳號，臉部特徵與設定只存在你自己的手機裡。

| 解鎖 | 對話 |
|---|---|
| 掃描你的臉才進得去，另有備用密碼 | 打字或直接開口說，JARVIS 會唸回覆給你聽 |

---

## 功能

- **人臉辨識解鎖** — 用 `face-api.js` 在手機上本機運算（TinyFaceDetector + 128 維人臉描述子）。臉部特徵不會離開裝置。
  - 建檔時連拍 5 組特徵，比對取最小距離，需連續兩次通過才解鎖
  - 可開「眨眼活體偵測」，要求解鎖時眨一次眼
  - 辨識嚴格度可調
- **語音對話** — 說話輸入（Web Speech API）+ 語音朗讀回覆（可挑聲音、調語速）
  - **免持連續對話**：JARVIS 講完自動再打開麥克風，整段對話不用碰手機
- **真正的 AI** — 接 Anthropic Claude API，串流回覆，支援長期記憶與個性設定
- **加入主畫面就像原生 App** — 全螢幕、有圖示、離線可開（模型會快取在手機上）
- **一切都在本機** — 臉部特徵、密碼雜湊、對話紀錄、API 金鑰都存在瀏覽器的 localStorage

---

## 快速開始

### 1. 放上網（必須是 https，否則 iOS 不給用相機）

最簡單是 GitHub Pages：

1. 把這個 repo 推上 GitHub
2. `Settings` → `Pages` → Source 選 `Deploy from a branch`，分支選你的分支、資料夾選 `/ (root)`
3. 等一兩分鐘，網址會是 `https://<你的帳號>.github.io/<repo 名稱>/`

Netlify、Vercel、Cloudflare Pages 直接拖資料夾也可以，這是純靜態網站。

### 2. 用 **Safari** 開啟並加入主畫面

> 一定要用 Safari，Chrome for iOS 沒辦法安裝 PWA。

1. Safari 開上面那個網址
2. 點下方的「分享」按鈕 <kbd>􀈂</kbd>
3. 選 **「加入主畫面」** → 命名 JARVIS → 加入
4. 回主畫面點那個藍色圖示打開（這樣才是全螢幕模式）

### 3. 初始化

第一次打開會走設定流程：

1. **你的稱呼** — JARVIS 會這樣叫你
2. **臉部建檔** — 按「開始建檔」，正對鏡頭，等 5 個點都亮起來（第一次要下載約 6MB 的模型，需要一點時間）
3. **備用密碼** — 至少 4 位，辨識失敗或戴口罩時用
4. **API 金鑰** — 到 [console.anthropic.com](https://console.anthropic.com/settings/keys) 申請一把 `sk-ant-...` 貼上

完成後就進入對話畫面。之後每次打開都要通過人臉辨識。

---

## 日常使用

| 想做什麼 | 怎麼做 |
|---|---|
| 解鎖 | 打開 App → 「開始人臉辨識」→ 看著鏡頭 |
| 辨識不過 | 「改用密碼進入」 |
| 用說的 | 點左下角 🎙 說話，說完自動送出 |
| 免持模式 | 右上角 🔁，之後 JARVIS 講完會自動再聽你說 |
| 關掉朗讀 | 右上角 🔊 |
| 停止產生中的回覆 | 送出鍵會變成 ■，按一下即停 |
| 立即上鎖 | 右上角 ⏻ |

App 切到背景超過 5 分鐘會自動重新上鎖。

---

## 設定（右上角 ⚙︎）

- **個性 / 指令** — 想要什麼講話風格就寫什麼，例如「像英國管家、句子短、別客套」
- **長期記憶** — 寫在這裡的東西每次對話都會帶上：家人、公司、偏好、常用工具…
- **模型** — 預設 Claude Opus 5；想更快更省可改 Sonnet 5 或 Haiku 4.5
- **思考深度** — 語音對話建議「低」，回得最快；要它認真想事情時改「高」
- **辨識嚴格度** — 數字越小越嚴格。認不出自己就往上調一點（0.50），怕被別人解開就往下調（0.40）
- **眨眼活體偵測** — 開了之後解鎖時要眨一次眼，可以擋掉拿照片對著鏡頭的情況

---

## API 金鑰要放哪？兩種做法

**做法 A（預設，最簡單）**：金鑰填在 App 設定裡，存在手機瀏覽器，直接呼叫 `api.anthropic.com`。
方便，但任何能解開你手機、進到這個 App 的人都能用你的額度。建議在 Anthropic Console 給這把金鑰設消費上限。

**做法 B（比較安全）**：用 `worker/` 裡的 Cloudflare Worker 當代理，金鑰放在伺服器端，手機上不留金鑰。

```bash
npm i -g wrangler
cd worker
wrangler secret put ANTHROPIC_API_KEY   # 貼上你的金鑰
wrangler deploy
```

部署完把 Worker 網址填進 App 設定的「Proxy 網址」，金鑰欄位留空。
建議同時在 `wrangler.toml` 設 `ALLOWED_ORIGIN` 成你的 App 網址，避免別人拿你的 Worker 來用。

---

## 老實說：安全性到哪裡

這個人臉辨識**擋得住**隨手拿起你手機的人，**擋不住**存心要開的人：

- 拿你的照片對著鏡頭有機會通過（開啟眨眼偵測可以提高難度，但不是萬無一失）
- 臉部特徵、密碼雜湊、API 金鑰都在瀏覽器的 localStorage，能存取你手機瀏覽器資料的人就拿得到
- 這裡沒有加密儲存、沒有伺服器驗證，就只是一道門

**請把它當成「隱私門簾」，不要當成保險箱。** 真正的機密不要放進對話裡。
（順帶一提：對話內容會送到 Anthropic 的 API 才有回覆，這部分跟任何 AI App 一樣。臉部影像則完全沒有離開過手機。）

---

## 本機開發

```bash
node tools/serve.js          # http://localhost:8080
```

`localhost` 被瀏覽器視為安全來源，所以電腦上可以直接測相機。
手機測試則一定要 https 網址。

跑一次端對端煙霧測試（不需要相機或 API 金鑰，會用假的串流回應）：

```bash
npm i -D playwright && npx playwright install chromium
node tools/test-e2e.mjs
```

驗證模型載入、辨識流程、設定精靈的檢查、密碼解鎖、串流對話、設定儲存與 Service Worker。
「認不認得出本人」沒辦法在無相機環境測，那部分請用實機確認。

改了圖示設計的話：

```bash
python3 tools/make-icons.py  # 重新產生 icons/
```

改了檔案清單或想強制更新快取，把 `sw.js` 裡的 `VERSION` 加一號。

---

## 專案結構

```
index.html              單頁 App：鎖定 / 設定 / 對話 三個畫面
manifest.webmanifest    PWA 設定（圖示、全螢幕、主題色）
sw.js                   Service Worker：外殼預快取、模型用到才快取
css/app.css             深色 HUD 風格樣式
js/
  app.js                主流程：畫面切換、解鎖、送訊息、免持迴圈
  face.js               人臉：載模型、開相機、建檔、驗證、眨眼偵測
  voice.js              語音：辨識輸入、朗讀輸出、挑聲音
  claude.js             Claude：系統提示、串流對話、錯誤翻譯
  store.js              localStorage：設定、臉部特徵、密碼雜湊、對話
vendor/                 face-api.js 與打包好的 Anthropic SDK
models/                 人臉模型權重（約 6.7MB，第一次用到才下載）
worker/                 選用的 Cloudflare Worker 代理
tools/                  本機伺服器、圖示產生器、端對端測試
```

---

## 疑難排解

**相機打不開 / 一直說權限被拒**
- 網址一定要是 `https://`（GitHub Pages 本來就是）
- iOS：`設定` → `Safari` → `相機` 設成「詢問」或「允許」
- 已經拒絕過的話，在 Safari 開同一個網址，長按網址列 → 網站設定 → 重設權限，然後重新加入主畫面

**認不出我自己**
- 設定裡把「辨識嚴格度」往上調到 0.50
- 或重新建檔：在光線更接近日常使用的環境下再拍一次

**沒有聲音**
- 檢查手機側邊的靜音開關
- 右上角 🔊 要是亮的
- 設定裡的「語音」選一個 `zh-TW` 的聲音

**語音輸入沒反應**
- iOS 需要 14.5 以上；`設定` → `Safari` → `麥克風` 要允許
- 部分 iOS 版本在主畫面模式下語音辨識不穩定，這時候用鍵盤輸入照樣可以對話

**離線打不開**
- 第一次一定要連網開過一次（要下載模型與快取檔案）
- 沒有網路時可以開 App、看歷史對話，但沒辦法產生新回覆

---

## 第三方元件

- [face-api.js](https://github.com/vladmandic/face-api)（`@vladmandic/face-api`）— MIT，`vendor/face-api.LICENSE`
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) — MIT，`vendor/anthropic-sdk.LICENSE`

模型權重來自 face-api.js 專案，已放進 `models/`，讓 App 不依賴任何 CDN。
