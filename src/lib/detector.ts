import type { Calibration, CrestLine, FrameQuality, WeatherCondition } from '../types';
import { horizonY, wallPixelsToHeightM } from './geometry';

export interface PixelFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  timeSec: number;
  frameNo: number;
  weather?: WeatherCondition;
}

interface ComponentStats {
  label: number;
  count: number;
  sx: number;
  sy: number;
  sxx: number;
  sxy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[x] !== x) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function rgbToLuma(data: PixelFrame['data'], i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

export function assessFrameQuality(frame: PixelFrame, weather?: string): FrameQuality {
  const { data, width, height } = frame;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  let white = 0;
  let verticalEnergy = 0;
  let verticalCount = 0;

  for (let y = Math.floor(height * 0.22); y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * 4;
      const l = rgbToLuma(data, i);
      sum += l;
      sumSq += l * l;
      n++;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (l > 168 && max - min < 82) white++;
      if (y + 2 < height) {
        verticalEnergy += Math.abs(l - rgbToLuma(data, ((y + 2) * width + x) * 4));
        verticalCount++;
      }
    }
  }

  const mean = n ? sum / n : 128;
  const variance = n ? Math.max(0, sumSq / n - mean * mean) : 0;
  const contrast = Math.sqrt(variance);
  const whiteRatio = n ? white / n : 0;
  const rainScore = Math.min(1, verticalCount ? verticalEnergy / verticalCount / 24 : 0);
  const glareScore = Math.max(0, Math.min(1, (mean - 176) / 48 + (whiteRatio - 0.08) * 2));
  const flags: string[] = [];
  let factor = 1;

  if (weather === 'rain') {
    factor *= 0.68;
    flags.push('下雨：雨滴和海面杂波会抬高误检率');
  }
  if (weather === 'backlight') {
    factor *= 0.62;
    flags.push('逆光：白沫与眩光对比度下降');
  }
  if (weather === 'fog') {
    factor *= 0.55;
    flags.push('雾天：远景浪峰边缘模糊');
  }
  if (mean > 202 || glareScore > 0.72) {
    factor *= 0.82;
    if (!flags.some((f) => f.includes('逆光'))) flags.push('画面眩光偏强，可信度降低');
  }
  if (contrast < 34) {
    factor *= 0.8;
    flags.push('画面对比度偏低，浪壁边缘不稳定');
  }
  if (rainScore > 0.72 && weather !== 'rain') {
    factor *= 0.82;
    flags.push('高频雨线/杂波明显');
  }

  return {
    meanLuma: mean,
    contrast,
    whiteRatio,
    rainScore,
    glareScore,
    confidenceFactor: Math.max(0.28, Math.min(1, factor)),
    flags,
  };
}

function isFoamPixel(data: PixelFrame['data'], i: number): boolean {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 150 && max - min < 92 && min > 105;
}

function estimateWallHeight(
  frame: PixelFrame,
  line: Pick<CrestLine, 'slope' | 'intercept' | 'centerX' | 'thicknessPx' | 'x1' | 'x2'>,
  cal: Calibration,
): { heightM: number | null; wallHeightPx: number | null; baseYAtReef: number | null } {
  const { data, width, height } = frame;
  const candidates: number[] = [];
  const pxHeights: number[] = [];
  const baseReefYs: number[] = [];
  const reefX = cal.reef.x * width;
  const xStart = Math.max(4, Math.round(Math.min(line.x1, line.x2) + 8));
  const xEnd = Math.min(width - 5, Math.round(Math.max(line.x1, line.x2) - 8));
  const span = xEnd - xStart;
  if (span < 12) return { heightM: null, wallHeightPx: null, baseYAtReef: null };

  for (let k = 0; k < 9; k++) {
    const x = Math.round(xStart + (span * k) / 8);
    const yLip = line.slope * x + line.intercept;
    const y0 = Math.max(2, Math.round(yLip + line.thicknessPx * 0.35));
    const maxDrop = Math.round(Math.max(22, height * 0.16));
    let bestY = -1;
    let bestScore = -Infinity;

    for (let y = y0 + 3; y < Math.min(height - 5, y0 + maxDrop); y++) {
      const up = rgbToLuma(data, ((y - 3) * width + x) * 4);
      const down = rgbToLuma(data, ((y + 3) * width + x) * 4);
      const grad = down - up;
      let wallSum = 0;
      let wallN = 0;
      for (let yy = y0; yy < y; yy += 2) {
        wallSum += rgbToLuma(data, (yy * width + x) * 4);
        wallN++;
      }
      let foreSum = 0;
      let foreN = 0;
      for (let yy = y + 2; yy < Math.min(height, y + 9); yy++) {
        foreSum += rgbToLuma(data, (yy * width + x) * 4);
        foreN++;
      }
      const wallLuma = wallN ? wallSum / wallN : up;
      const foreLuma = foreN ? foreSum / foreN : down;
      const score = grad * 1.4 + (foreLuma - wallLuma) * 0.45 - Math.abs(y - y0 - 18) * 0.12;
      if (score > bestScore && grad > 5) {
        bestScore = score;
        bestY = y;
      }
    }

    if (bestY > 0 && bestScore > 18) {
      const h = wallPixelsToHeightM(bestY, yLip, width, height, cal);
      if (h !== null && h >= 0.25 && h <= 5.5) {
        candidates.push(h);
        pxHeights.push(bestY - yLip);
        baseReefYs.push(bestY - line.slope * (x - reefX));
      }
    }
  }

  candidates.sort((a, b) => a - b);
  pxHeights.sort((a, b) => a - b);
  baseReefYs.sort((a, b) => a - b);
  if (!candidates.length) return { heightM: null, wallHeightPx: null, baseYAtReef: null };
  const mid = candidates.length >> 1;
  const baseMid = baseReefYs.length >> 1;
  return {
    heightM: candidates.length % 2 ? candidates[mid] : (candidates[mid - 1] + candidates[mid]) / 2,
    wallHeightPx: pxHeights[pxHeights.length >> 1],
    baseYAtReef: baseReefYs.length % 2 ? baseReefYs[baseMid] : (baseReefYs[baseMid - 1] + baseReefYs[baseMid]) / 2,
  };
}

export function detectCrests(frame: PixelFrame, cal: Calibration, quality: FrameQuality): CrestLine[] {
  const started = performance.now();
  const { data, width, height } = frame;
  const calibratedHorizon = horizonY(cal, height);
  const roiTop = Math.max(1, Math.ceil(Number.isFinite(calibratedHorizon) ? calibratedHorizon + 8 : height * 0.24));
  const roiBottom = Math.min(height - 2, Math.floor(height * 0.94));
  const n = width * height;
  const labels = new Int32Array(n);
  labels.fill(-1);
  const uf = new UnionFind(n);
  let nextLabel = 0;

  for (let y = roiTop; y < roiBottom; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (!isFoamPixel(data, idx * 4)) continue;
      const up = labels[idx - width];
      const left = labels[idx - 1];
      if (up < 0 && left < 0) {
        labels[idx] = nextLabel++;
      } else if (up >= 0 && left < 0) {
        labels[idx] = up;
      } else if (up < 0 && left >= 0) {
        labels[idx] = left;
      } else {
        const root = Math.min(up, left);
        labels[idx] = root;
        uf.union(up, left);
      }
    }
  }

  const stats = new Map<number, ComponentStats>();
  for (let y = roiTop; y < roiBottom; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (labels[idx] < 0) continue;
      const root = uf.find(labels[idx]);
      labels[idx] = root;
      let s = stats.get(root);
      if (!s) {
        s = {
          label: root,
          count: 0,
          sx: 0,
          sy: 0,
          sxx: 0,
          sxy: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
        };
        stats.set(root, s);
      }
      s.count++;
      s.sx += x;
      s.sy += y;
      s.sxx += x * x;
      s.sxy += x * y;
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;
    }
  }

  const reefX = cal.reef.x * width;
  const minLength = Math.max(18, width * 0.055);
  const lines: CrestLine[] = [];

  for (const s of stats.values()) {
    const xSpan = s.maxX - s.minX;
    const ySpan = s.maxY - s.minY;
    if (s.count < Math.max(24, width * 0.05) || xSpan < minLength) continue;
    if (ySpan > height * 0.22) continue;

    // Covariance fit from accumulated moments is cheaper and stable for components.
    const denom = s.count * s.sxx - s.sx * s.sx;
    if (Math.abs(denom) < 1e-6) continue;
    const slope = (s.count * s.sxy - s.sx * s.sy) / denom;
    if (!Number.isFinite(slope) || Math.abs(slope) > 1.4) continue;
    const intercept = (s.sy - slope * s.sx) / s.count;
    const centerX = s.sx / s.count;
    const centerY = s.sy / s.count;
    const lengthPx = Math.hypot(xSpan, slope * xSpan);
    if (lengthPx < minLength * 1.15) continue;

    const x1 = s.minX;
    const x2 = s.maxX;
    const y1 = slope * x1 + intercept;
    const y2 = slope * x2 + intercept;
    const thicknessPx = Math.max(2.5, s.count / Math.max(1, xSpan));
    const residualPx = Math.max(1.4, thicknessPx * 0.48);
    const wall = estimateWallHeight(
      frame,
      { slope, intercept, centerX, thicknessPx, x1, x2 },
      cal,
    );
    const yAtReef = slope * reefX + intercept;
    const nearReef = reefX >= s.minX - width * 0.08 && reefX <= s.maxX + width * 0.08;
    const lengthScore = Math.min(1, lengthPx / (width * 0.28));
    const residualScore = Math.max(0.25, 1 - residualPx / 7);
    const reefScore = nearReef ? 1 : 0.72;
    const wallScore = wall.heightM === null ? 0.72 : 1;
    const detectionConfidence =
      Math.max(0.18, Math.min(0.98, (0.34 + 0.3 * lengthScore + 0.18 * residualScore + 0.1 * reefScore + 0.08 * wallScore) * quality.confidenceFactor));

    lines.push({
      id: `f${frame.frameNo}-c${s.label}`,
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      x1,
      y1,
      x2,
      y2,
      slope,
      intercept,
      centerX,
      centerY,
      yAtReef,
      area: s.count,
      lengthPx,
      thicknessPx,
      residualPx,
      wallHeightPx: wall.wallHeightPx,
      wallBaseY: wall.baseYAtReef,
      heightM: wall.heightM,
      detectionConfidence,
    });
  }

  lines.sort((a, b) => b.detectionConfidence - a.detectionConfidence);
  // Keep distinct y-intercept bands; rain can create multiple components from one crest.
  const distinct: CrestLine[] = [];
  for (const line of lines) {
    const duplicate = distinct.some((d) => Math.abs(d.yAtReef - line.yAtReef) < Math.max(10, height * 0.055));
    if (!duplicate) distinct.push(line);
    if (distinct.length >= 6) break;
  }

  void started;
  return distinct;
}

export function analyzeFrame(frame: PixelFrame, cal: Calibration, weather?: string): import('../types').FrameDetection {
  const t0 = performance.now();
  const quality = assessFrameQuality(frame, weather);
  const lines = detectCrests(frame, cal, quality);
  return {
    timeSec: frame.timeSec,
    frameNo: frame.frameNo,
    lines,
    quality,
    processingMs: performance.now() - t0,
  };
}
