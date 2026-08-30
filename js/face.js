// 人臉辨識：face-api.js（TinyFaceDetector + 68 點 tiny 特徵點 + 128 維描述子）
// 模型檔已放進 models/，全部在裝置本機運算，不會上傳任何影像。
import { face as faceStore } from './store.js';

const MODEL_URL = './models';
const DETECT_OPTS = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });

let modelsReady = null;

export async function loadModels() {
  if (modelsReady) return modelsReady;
  modelsReady = (async () => {
    try {
      await faceapi.tf.setBackend('webgl');
    } catch {
      await faceapi.tf.setBackend('cpu');
    }
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
  })();
  return modelsReady;
}

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('這個瀏覽器不支援相機，請用 Safari 開啟（且必須是 https 網址）。');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});
  // 等到真的有畫面尺寸，否則第一次偵測會拿到空張量
  if (!video.videoWidth) {
    await new Promise((resolve) => {
      const done = () => resolve();
      video.addEventListener('loadeddata', done, { once: true });
      setTimeout(done, 3000);
    });
  }
  return stream;
}

export function stopCamera(video) {
  const stream = video?.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}

async function detectOnce(video) {
  if (!video.videoWidth) return null;
  return faceapi
    .detectSingleFace(video, DETECT_OPTS())
    .withFaceLandmarks(true)   // true = 使用 tiny 特徵點模型
    .withFaceDescriptor();
}

// 眼睛開合比（Eye Aspect Ratio），用來偵測眨眼
function eyeAspectRatio(eye) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]) || 1);
}

function earOf(result) {
  try {
    const lm = result.landmarks;
    return (eyeAspectRatio(lm.getLeftEye()) + eyeAspectRatio(lm.getRightEye())) / 2;
  } catch {
    return null;
  }
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export function bestDistance(descriptor, samples) {
  let best = Infinity;
  for (const s of samples) best = Math.min(best, distance(descriptor, s));
  return best;
}

function centroidOf(samples) {
  const c = new Float32Array(samples[0].length);
  for (const s of samples) for (let i = 0; i < c.length; i += 1) c[i] += s[i];
  for (let i = 0; i < c.length; i += 1) c[i] /= samples.length;
  return c;
}

/**
 * 比對分數。用「到重心的距離」當判斷依據：多組樣本平均掉雜訊後，
 * 本人的距離會更短，別人的不會，兩者拉得比較開。
 * （舊版取樣本中的最小距離，等於每次都挑最寬鬆的那組，家人很容易過。）
 */
export function scoreOf(descriptor, enrolled) {
  if (!enrolled.centroid) enrolled.centroid = centroidOf(enrolled.samples);
  return {
    score: distance(descriptor, enrolled.centroid),
    min: bestDistance(descriptor, enrolled.samples),
  };
}

/** 建檔樣本自己有多分散，用來提醒建檔品質 */
export function enrollmentSpread(samples) {
  const c = centroidOf(samples);
  return Math.max(...samples.map((s) => distance(s, c)));
}

/** 建檔：連續取得 count 組互相一致的描述子 */
export async function enroll(video, { count = 5, onSample, onStatus } = {}) {
  await loadModels();
  const samples = [];
  const deadline = Date.now() + 45000;

  while (samples.length < count) {
    if (Date.now() > deadline) throw new Error('建檔逾時，請在光線充足的地方再試一次。');
    const result = await detectOnce(video);
    if (!result) {
      onStatus?.('沒看到人臉，請正對鏡頭…');
      await wait(200);
      continue;
    }
    const d = result.descriptor;
    // 與已收集樣本差太多的丟掉，避免中途換人或嚴重模糊
    if (samples.length && bestDistance(d, samples) > 0.6) {
      onStatus?.('畫面變動太大，請保持穩定…');
      await wait(250);
      continue;
    }
    samples.push(d);
    onSample?.(samples.length, count);
    onStatus?.(`已擷取 ${samples.length} / ${count}`);
    await wait(420); // 稍微間隔，取得不同角度與光線
  }
  faceStore.save(samples);
  return samples;
}

/**
 * 驗證：持續偵測直到通過、逾時或被中止。
 * 回傳 { ok:true } 或 { ok:false, reason }
 */
export async function verify(video, {
  threshold = 0.38,
  timeoutMs = 20000,
  needConsecutive = 3,
  liveness = false,
  onStatus,
  shouldStop,
} = {}) {
  const enrolled = faceStore.load();
  if (!enrolled) return { ok: false, reason: 'no-enrollment' };
  await loadModels();

  const deadline = Date.now() + timeoutMs;
  let hits = 0;
  let blinked = !liveness;
  let eyesWereClosed = false;
  let sawFace = false;

  while (Date.now() < deadline) {
    if (shouldStop?.()) return { ok: false, reason: 'aborted' };
    const result = await detectOnce(video);

    if (!result) {
      hits = 0;
      onStatus?.(sawFace ? '請保持在畫面中…' : '搜尋人臉中…');
      await wait(120);
      continue;
    }
    sawFace = true;

    if (liveness) {
      const ear = earOf(result);
      if (ear !== null) {
        if (ear < 0.19) eyesWereClosed = true;
        else if (eyesWereClosed && ear > 0.26) blinked = true;
      }
    }

    const { score } = scoreOf(result.descriptor, enrolled);
    if (score <= threshold) {
      hits += 1;
      onStatus?.(blinked
        ? `身分比對中… ${hits} / ${needConsecutive}`
        : '請眨一下眼睛');
      if (hits >= needConsecutive && blinked) return { ok: true, distance: score };
    } else {
      hits = 0;
      onStatus?.(score < threshold + 0.08 ? '再靠近一點、正對鏡頭…' : '無法識別此人臉');
    }
    await wait(90);
  }
  return { ok: false, reason: sawFace ? 'no-match' : 'no-face' };
}

/**
 * 辨識測試：持續回報鏡頭前這個人的比對分數，不會解鎖。
 * 用來實際量測：本人大概多少、家人大概多少，再把門檻設在中間。
 */
export async function probe(video, { onTick, shouldStop } = {}) {
  const enrolled = faceStore.load();
  if (!enrolled) throw new Error('尚未建立臉部檔案。');
  await loadModels();

  while (!shouldStop?.()) {
    const result = await detectOnce(video);
    if (!result) onTick?.({ found: false });
    else onTick?.({ found: true, ...scoreOf(result.descriptor, enrolled) });
    await wait(120);
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
