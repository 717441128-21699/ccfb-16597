import type { Calibration, FrameDetection } from '../types';

export function drawAnalysisOverlay(
  canvas: HTMLCanvasElement,
  detection: FrameDetection | null,
  width: number,
  height: number,
  cal: Calibration,
): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const rx = cal.reef.x * width;
  const ry = cal.reef.y * height;

  // Calibrated reef crossing marker.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,200,87,.9)';
  ctx.fillStyle = 'rgba(255,200,87,.16)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(rx, ry, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rx - 13, ry);
  ctx.lineTo(rx + 13, ry);
  ctx.moveTo(rx, ry - 13);
  ctx.lineTo(rx, ry + 13);
  ctx.stroke();
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillStyle = '#ffd98a';
  ctx.fillText('基准礁石', rx + 13, ry - 10);
  ctx.restore();

  if (!detection) return;

  detection.lines.forEach((line, i) => {
    const alpha = Math.max(0.45, line.detectionConfidence);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(85,224,210,.8)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = i === 0 ? `rgba(85,224,210,${alpha})` : `rgba(98,168,255,${alpha * 0.8})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center tracking point.
    ctx.fillStyle = '#eafffd';
    ctx.beginPath();
    ctx.arc(line.centerX, line.centerY, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Reef intercept.
    ctx.strokeStyle = 'rgba(255,255,255,.42)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx, line.yAtReef);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = `C${i + 1} ${line.heightM ? `${line.heightM.toFixed(1)}m` : '壁高…'} · ${Math.round(line.detectionConfidence * 100)}%`;
    ctx.font = '800 12px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    const lx = Math.max(6, Math.min(width - tw - 6, line.x1));
    const ly = Math.max(18, line.y1 - 24);
    ctx.fillStyle = 'rgba(3,18,28,.82)';
    roundRect(ctx, lx, ly - 14, tw, 20, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(85,224,210,.35)';
    ctx.stroke();
    ctx.fillStyle = '#dffffb';
    ctx.fillText(label, lx + 6, ly);
    ctx.restore();
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
