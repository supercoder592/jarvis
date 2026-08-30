// QR 配對：舊裝置顯示、新裝置掃描。
// 用相機掃一次就把整套設定帶過去，不用在手機上打 token 跟密語。
import { jsQR, QRCode } from '../vendor/qr.esm.js';

export async function draw(canvas, text) {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 260,
    color: { dark: '#04131f', light: '#dbeefc' },
  });
}

/**
 * 從影像串流裡找 QR。找到就呼叫 onFound 並停止。
 * 回傳一個可呼叫的 stop()。
 */
export function scan(video, { onFound, onTick, shouldStop } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let raf = 0;

  const tick = () => {
    if (stopped || shouldStop?.()) return;
    if (video.readyState >= 2 && video.videoWidth) {
      // 掃描不需要原始解析度，縮小一點比較省電也夠用
      const scale = Math.min(1, 480 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (found?.data) {
        stopped = true;
        onFound(found.data);
        return;
      }
      onTick?.();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => { stopped = true; cancelAnimationFrame(raf); };
}
