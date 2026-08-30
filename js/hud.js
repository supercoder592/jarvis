// HUD 立體感：讓中央的陀螺環隨手機傾斜（或桌機滑鼠）產生視差。
// iOS 13 之後 DeviceOrientation 需要使用者手勢才能要權限，
// 所以由「開始人臉辨識」那一下點擊觸發。
let rig = null;
let raf = 0;
let active = false;
let base = null;
const target = { x: 0, y: 0 };
const current = { x: 0, y: 0 };

const clamp = (v, max) => Math.max(-max, Math.min(max, v));
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function attach(rigEl) {
  rig = rigEl;
  if (!rig || reduced) return;
  // 桌機：用滑鼠位置當視差來源
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    target.y = clamp((e.clientX / window.innerWidth - 0.5) * 26, 13);
    target.x = clamp((0.5 - e.clientY / window.innerHeight) * 20, 10);
  }, { passive: true });
  setActive(true);
}

/** 需要在使用者手勢裡呼叫，才要得到 iOS 的動作感應權限 */
export async function enableMotion() {
  if (reduced) return false;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return false;
  try {
    if (typeof DOE.requestPermission === 'function') {
      if (await DOE.requestPermission() !== 'granted') return false;
    }
  } catch {
    return false;
  }
  window.addEventListener('deviceorientation', onOrient, { passive: true });
  return true;
}

function onOrient(e) {
  if (e.beta === null || e.gamma === null) return;
  // 第一次讀到的姿勢當作原點，之後只看相對變化
  if (!base) base = { beta: e.beta, gamma: e.gamma };
  target.x = clamp(-(e.beta - base.beta) * 0.4, 12);
  target.y = clamp((e.gamma - base.gamma) * 0.4, 14);
}

export function setActive(on) {
  active = on && !reduced && !!rig;
  if (active && !raf) raf = requestAnimationFrame(tick);
  if (!active && raf) { cancelAnimationFrame(raf); raf = 0; }
  if (!on && rig) { rig.style.removeProperty('--rx'); rig.style.removeProperty('--ry'); }
}

function tick() {
  // 平滑追隨，避免畫面抖動
  current.x += (target.x - current.x) * 0.08;
  current.y += (target.y - current.y) * 0.08;
  rig.style.setProperty('--rx', `${current.x.toFixed(2)}deg`);
  rig.style.setProperty('--ry', `${current.y.toFixed(2)}deg`);
  raf = active ? requestAnimationFrame(tick) : 0;
}

/** 重新校正原點：換姿勢拿手機時用 */
export function recenter() {
  base = null;
}
