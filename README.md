# JARVIS — 你自己的個人 AI 助理

一個裝在 iPhone 主畫面上的私人助理：**人臉辨識解鎖**、**語音對話**、離線也打得開。
純前端 PWA，沒有後端、沒有帳號，臉部特徵與設定只存在你自己的手機裡。

| 解鎖 | 對話 |
|---|---|
| 掃描你的臉才進得去，另有備用密碼 | 打字或直接開口說，JARVIS 會唸回覆給你聽 |

---

## 功能

- **人臉辨識解鎖** — 用 `face-api.js` 在手機上本機運算（TinyFaceDetector + 128 維人臉描述子）。臉部特徵不會離開裝置。
  - 建檔時連拍 5 組特徵，比對算「與這 5 組重心的距離」，需連續三幀通過才解鎖
  - 內建辨識測試工具，可以直接量出誰會被放行、誰會被擋
  - 可開「眨眼活體偵測」，要求解鎖時眨一次眼
  - 辨識嚴格度可調
- **語音對話** — 說話輸入（Web Speech API）+ 語音朗讀回覆（可挑聲音、調語速）
  - **免持連續對話**：JARVIS 講完自動再打開麥克風，整段對話不用碰手機
- **會自己記事情** — 聊到生日、家人、住哪、偏好，它會自動寫進長期記憶，
  並在對話裡告訴你記了什麼；下次開 App 還記得。不想留的自己刪掉就好
- **兩家 AI 供應商** — Claude（Anthropic）或 Gemini（Google，**有免費額度**），
  在設定裡一鍵切換，兩邊的金鑰與模型各自記住；串流回覆，支援長期記憶與個性設定
- **加入主畫面就像原生 App** — 全螢幕、有圖示、離線可開（模型會快取在手機上）
- **立體 HUD 介面** — 透視網格背景、環繞核心的 3D 陀螺環、玻璃質感面板；
  傾斜手機時整組 HUD 會跟著轉（用 DeviceOrientation 做視差，桌機則跟著滑鼠）
- **跨裝置同步（端對端加密）** — 記憶、設定、金鑰、臉部檔案可以同步到另一台裝置，
  資料在手機上先加密才上傳，GitHub 只看得到密文
- **預設一切都在本機** — 沒開同步的話，臉部特徵、密碼雜湊、對話紀錄、API 金鑰都只在這支手機的 localStorage 裡

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
4. **API 金鑰** — 挑一家：
   - **Gemini（有免費額度，推薦先用這個）**：到 [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
     申請，貼進設定裡的「Gemini API 金鑰」，供應商選 Gemini
   - **Claude**：到 [console.anthropic.com](https://console.anthropic.com/settings/keys)
     申請 `sk-ant-...`，是付費的，但比較聰明

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
- **讓 JARVIS 自己記下重要的事** — 預設開啟。它會在回覆裡夾帶記憶指令，
  App 攔下來寫進上面那欄（你看不到指令本身），並顯示「已記住：…」。
  跟它說「忘掉我的貓」也會照做。不想讓它自己動就把這個關掉
- **AI 供應商** — Claude 或 Gemini，見下面的比較
- **模型** — 各家的模型清單；Gemini 可以線上查詢最新可用的
- **Workspace ID** — 只有「身分綁定」型的金鑰才需要填，見下面的疑難排解
- **思考深度** — 語音對話建議「低」，回得最快；要它認真想事情時改「高」
- **辨識嚴格度** — 數字越小越嚴格，預設 0.38。認不出自己往上調，家人能解開往下調
- **辨識測試** — 最有用的一顆按鈕：開著它讓不同人站到鏡頭前，直接看每個人拿到幾分，
  再把嚴格度設在「你的分數」和「別人的分數」中間。不用猜
- **眨眼活體偵測** — 開了之後解鎖時要眨一次眼，可以擋掉拿照片對著鏡頭的情況

---

## 該用哪一家？

| | Gemini | Claude |
|---|---|---|
| 費用 | **有免費額度**，超過才要錢 | 純付費，用多少算多少 |
| 限制 | 免費額度有每分鐘／每日次數上限 | 沒有免費額度 |
| 適合 | 日常閒聊、隨手問問題 | 要它認真想事情 |
| 申請 | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

⚙︎ 設定 →「AI 供應商」可以隨時切換，兩邊的金鑰和模型選擇會各自記住，換來換去不會弄丟。

Gemini 那邊還有一顆「**載入這把金鑰目前可用的模型**」：按下去會直接問 Google
你這把金鑰現在能用哪些模型，不必擔心內建的名單過時。免費額度用完會回 429，
App 會直接告訴你「免費額度的用量上限到了」，等幾分鐘或換成 Flash Lite 就好。

## API 金鑰要放哪？兩種做法

**做法 A（預設，最簡單）**：金鑰填在 App 設定裡，存在手機瀏覽器，直接呼叫 `api.anthropic.com`。
方便，但任何能解開你手機、進到這個 App 的人都能用你的額度。建議在 Anthropic Console 給這把金鑰設消費上限。

**做法 B（比較安全，目前只支援 Claude）**：用 `worker/` 裡的 Cloudflare Worker 當代理，金鑰放在伺服器端，手機上不留金鑰。

```bash
npm i -g wrangler
cd worker
wrangler secret put ANTHROPIC_API_KEY   # 貼上你的金鑰
wrangler deploy
```

部署完把 Worker 網址填進 App 設定的「Proxy 網址」，金鑰欄位留空。
建議同時在 `wrangler.toml` 設 `ALLOWED_ORIGIN` 成你的 App 網址，避免別人拿你的 Worker 來用。

---

## 跨裝置同步

把一份**加密過的 JSON** 放在你自己的 GitHub repo 裡當中繼站。加密與解密都在裝置上做，
GitHub（和任何拿得到那個檔案的人）只會看到一團密文。

### 設定步驟

1. **開一個 private repo** 放同步檔，例如 `你的帳號/jarvis-data`
   （⚠️ 不要放在對外公開的 Pages repo 裡）
2. 產生一把 **fine-grained personal access token**：
   GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Repository access：**只選那一個 repo**
   - Permissions → Repository permissions → **Contents: Read and write**（其他都不要給）
   - Expiration：建議設一個到期日，到期再換一把
3. JARVIS → ⚙︎ →「跨裝置同步」：
   - 勾選「啟用同步」
   - Repo 填 `你的帳號/jarvis-data`
   - 貼上 Token
   - 按「**產生新密語**」→ 得到一組 32 碼的密語（這是解密金鑰，GitHub 永遠拿不到）
   - 按「立即同步」，成功的話下面會顯示同步時間
4. 到第二台裝置：⚙︎ →「**貼上連結碼**」
   （在第一台按「複製連結碼」，把那串貼過去，repo／Token／密語會一次填好）

之後解鎖時、切回 App 時、以及記憶有更新時，都會自動在背景同步。

### 會同步什麼

| 同步 | 不同步（每台裝置各自獨立） |
|---|---|
| 長期記憶、稱呼、個性指令 | 對話紀錄 |
| API 金鑰、供應商、模型選擇 | 語音、語速、朗讀開關 |
| 臉部辨識檔案（可關閉） | 辨識嚴格度、眨眼偵測、備用密碼 |

語音與辨識設定跟該台裝置的硬體、環境有關，所以刻意留在本機。

### 兩台同時改了怎麼辦

- **長期記憶取聯集**：兩台各自記到的事都會保留，不會互相蓋掉
- 其他設定以**比較新的那一份**為準
- 但「空值不會蓋掉有值的」：一台還沒填金鑰的新裝置，不會把雲端的金鑰洗掉

### 這套安全機制的邊界

- **GitHub 看不到內容**：AES-256-GCM，金鑰用 PBKDF2-SHA256（25 萬次）從密語導出
- **密語沒了就救不回來**：它只存在你的裝置上，我沒有後門，忘了就只能重新產生一組並重建資料
- **Token 被偷的話**：對方可以刪掉或覆蓋那個檔案，但**讀不懂內容**（沒有密語）。
  所以請務必用 fine-grained token 且只給一個 repo 的 Contents 權限，並設到期日
- **連結碼裡包含 Token 與密語**：它等於整套鑰匙，只在你自己的兩台裝置之間傳，不要貼到別的地方
- Token 和密語存在瀏覽器的 localStorage，跟 API 金鑰一樣——能存取你手機瀏覽器資料的人就拿得到

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
  ai.js                 供應商切換：Claude / Gemini 共用同一組介面
  claude.js             Claude：Anthropic SDK、串流對話、錯誤翻譯
  gemini.js             Gemini：REST + SSE、線上查詢可用模型、錯誤翻譯
  prompt.js             兩家共用的人格設定與對話整理
  memory.js             自動記憶：解析助理寫的記憶標籤、合併去重、上限管理
  crypto.js             端對端加密：PBKDF2 導金鑰、AES-256-GCM、密語產生
  sync.js               跨裝置同步：GitHub Contents API、合併策略、背景排程
  hud.js                介面：傾斜視差（iOS 需在使用者手勢中要權限）
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

**同步失敗**
- `GitHub Token 無效或已過期` → 重新產生一把 fine-grained token
- `找不到這個 repo 或路徑` → 確認 `owner/repo` 拼法，以及 token 有選到那個 repo
- `GitHub 拒絕存取` → token 的 Contents 權限要設成 Read and write
- `同步密語不對` → 兩台裝置的密語必須一模一樣，用「複製連結碼」最保險

**它亂編我的事情**
- 1.6.0 起已在指令裡寫明「長期記憶沒寫的就是不知道，不要猜」
- 記憶欄位是你可以直接編輯的，有錯的內容自己改掉或刪掉

**Gemini 一直轉、最後跳 Load failed**
- 1.5.1 已修正（SSE 事件分隔符沒認全）。請把 App 完全關掉再開，確認設定裡是 1.5.1 以上
- 若還是這樣：現在最多等 45 秒就會顯示錯誤而不是卡住，把錯誤訊息給我

**Gemini 回 429 / 說額度用完**
- 免費額度有每分鐘與每日的次數上限，等幾分鐘就會恢復
- 或在設定裡把模型換成 Flash Lite 這種比較省的

**出現 `anthropic-workspace-id is required` 的 400 錯誤**
- 你那把是「身分綁定（identity-linked）」金鑰，每次請求都要指明用哪個 workspace
- 到 ⚙︎ 設定填「Workspace ID」：在 [Anthropic Console](https://console.anthropic.com/) 切到該 workspace，網址裡的 `wrkspc_...` 就是
- 或到 Console 重新建一把綁定 workspace 的一般 API 金鑰，就不用填這欄

**家人也能解開 / 認不出我自己**
- 開 ⚙︎ 的「辨識測試」，讓兩個人輪流站到鏡頭前，記下各自的分數
- 把「辨識嚴格度」設在中間值。例如你 0.29、家人 0.44，就設 0.35 左右
- 兩個人的分數如果很接近，代表建檔品質不夠：重新建檔，光線充足、正對鏡頭、
  拍的時候臉稍微轉動一點點讓五張有變化
- 再不放心就開「眨眼活體偵測」，並把嚴格度壓到 0.30 以下

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
