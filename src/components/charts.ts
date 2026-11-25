import type { ConditionPoint } from '../types';

interface ChartOptions {
  heightMetric?: 'heightM' | 'surfScore';
}

export function renderConditionChart(canvas: HTMLCanvasElement, points: ConditionPoint[], _opts: ChartOptions = {}): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let hover: number | null = null;

  function draw(): void {
    if (!ctx || !canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width);
    const height = Math.max(280, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 48, r: 48, t: 24, b: 42 };
    const cw = width - pad.l - pad.r;
    const ch = height - pad.t - pad.b;
    const styles = getComputedStyle(document.documentElement);
    const fg = styles.getPropertyValue('--fg').trim() || '#eaf7ff';
    const muted = styles.getPropertyValue('--muted').trim() || '#91b2c5';
    const line = styles.getPropertyValue('--line').trim() || 'rgba(255,255,255,.14)';
    const accent = styles.getPropertyValue('--accent').trim() || '#55e0d2';
    const blue = styles.getPropertyValue('--accent-2').trim() || '#62a8ff';
    const warn = styles.getPropertyValue('--warn').trim() || '#ffc857';

    ctx.font = '12px system-ui, sans-serif';
    ctx.lineWidth = 1;

    if (!points.length) {
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.fillText('这一天还没有分析记录；可在浪况分析页完成一次分析，或载入示例全天曲线。', width / 2, height / 2);
      return;
    }

    const maxH = Math.max(2.5, ...points.map((p) => p.heightM * 1.25));
    const maxP = Math.max(14, ...points.map((p) => p.periodS * 1.15));
    const x = (i: number): number => pad.l + (points.length === 1 ? cw / 2 : (i / (points.length - 1)) * cw);
    const yH = (v: number): number => pad.t + ch - (v / maxH) * ch;
    const yP = (v: number): number => pad.t + ch - (v / maxP) * ch;

    // Grid and left axis.
    ctx.strokeStyle = line;
    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + (ch * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(pad.l + cw, yy);
      ctx.stroke();
      const hv = maxH * (1 - i / 4);
      ctx.fillText(`${hv.toFixed(1)}m`, pad.l - 9, yy + 4);
      const pv = maxP * (1 - i / 4);
      ctx.textAlign = 'left';
      ctx.fillStyle = blue;
      ctx.fillText(`${pv.toFixed(0)}s`, pad.l + cw + 9, yy + 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = muted;
    }

    // X labels, decimating on narrow screens.
    ctx.textAlign = 'center';
    const labelEvery = Math.ceil(points.length / Math.max(3, Math.floor(cw / 82)));
    points.forEach((p, i) => {
      if (i % labelEvery !== 0 && i !== points.length - 1) return;
      ctx.fillStyle = muted;
      ctx.fillText(p.time, x(i), height - 16);
    });

    // Confidence bands as vertical alpha.
    points.forEach((p, i) => {
      if (i === 0) return;
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
      grad.addColorStop(0, hexA(accent, 0.28 * p.confidence + 0.05));
      grad.addColorStop(1, hexA(accent, 0.02));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x(i - 1), pad.t + ch);
      ctx.lineTo(x(i - 1), yH(points[i - 1].heightM));
      ctx.lineTo(x(i), yH(p.heightM));
      ctx.lineTo(x(i), pad.t + ch);
      ctx.closePath();
      ctx.fill();
    });

    // Height line.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(x(i), yH(p.heightM));
      else ctx.lineTo(x(i), yH(p.heightM));
    });
    ctx.stroke();

    // Period dashed line.
    ctx.strokeStyle = blue;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(x(i), yP(p.periodS));
      else ctx.lineTo(x(i), yP(p.periodS));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Points.
    points.forEach((p, i) => {
      ctx.fillStyle = p.confidence < 0.6 ? warn : accent;
      ctx.beginPath();
      ctx.arc(x(i), yH(p.heightM), hover === i ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = blue;
      ctx.beginPath();
      ctx.arc(x(i), yP(p.periodS), hover === i ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    if (hover !== null && points[hover]) {
      const p = points[hover];
      const px = x(hover);
      ctx.strokeStyle = hexA(fg, 0.28);
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(px, pad.t);
      ctx.lineTo(px, pad.t + ch);
      ctx.stroke();
      ctx.setLineDash([]);

      const boxW = 178;
      const boxH = 92;
      let bx = px + 12;
      if (bx + boxW > width - 8) bx = px - boxW - 12;
      const by = pad.t + 10;
      ctx.fillStyle = 'rgba(4,17,27,.94)';
      ctx.strokeStyle = line;
      roundRect(ctx, bx, by, boxW, boxH, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textAlign = 'left';
      ctx.font = '700 13px system-ui';
      ctx.fillText(`${p.time} · ${p.waveCount} 道浪`, bx + 12, by + 22);
      ctx.font = '12px system-ui';
      ctx.fillStyle = accent;
      ctx.fillText(`波高 ${p.heightM.toFixed(2)} m`, bx + 12, by + 43);
      ctx.fillStyle = blue;
      ctx.fillText(`周期 ${p.periodS.toFixed(1)} s`, bx + 12, by + 62);
      ctx.fillStyle = p.confidence < 0.6 ? warn : muted;
      ctx.fillText(`可信度 ${Math.round(p.confidence * 100)}% · 评分 ${p.surfScore}`, bx + 12, by + 81);
    }
  }

  function onMove(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const padL = 48;
    const cw = rect.width - 96;
    if (!points.length) return;
    const rel = (mx - padL) / cw;
    const idx = Math.round(rel * (points.length - 1));
    hover = Math.max(0, Math.min(points.length - 1, idx));
    draw();
  }
  function onLeave(): void {
    hover = null;
    draw();
  }
  const ro = new ResizeObserver(draw);
  ro.observe(canvas);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  draw();
  return () => {
    ro.disconnect();
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
  };
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

function hexA(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.length === 4 ? color.split('').map((c) => c + c).join('').slice(1) : color.slice(1);
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return color;
}
