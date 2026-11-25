import type { Calibration } from '../types';

export const GRAVITY = 9.81;

export function focalLengthPx(cal: Pick<Calibration, 'imageWidth' | 'horizontalFovDeg'>, width = cal.imageWidth): number {
  return width / (2 * Math.tan((cal.horizontalFovDeg * Math.PI) / 180 / 2));
}

export function horizonY(cal: Calibration, height = cal.imageHeight): number {
  const f = focalLengthPx(cal);
  const cy = cal.imageHeight / 2;
  const yRef = cy - f * Math.tan((cal.tiltDeg * Math.PI) / 180);
  return (yRef / cal.imageHeight) * height;
}

/** Vertical ray angle below horizontal, radians. Positive points downward. */
export function rayDownAngleRad(y: number, width: number, height: number, cal: Calibration): number {
  void height;
  const f = focalLengthPx(cal, width);
  const cy = (cal.imageHeight / 2) * (width / cal.imageWidth);
  return (cal.tiltDeg * Math.PI) / 180 + Math.atan((y - cy) / f);
}

/** Flat-water distance from camera for a pixel row. */
export function rowToDistanceM(y: number, width: number, height: number, cal: Calibration): number {
  const theta = rayDownAngleRad(y, width, height, cal);
  if (theta <= 0.002) return Infinity;
  return cal.cameraHeightM / Math.tan(theta);
}

export function distanceToRowM(distanceM: number, width: number, height: number, cal: Calibration): number {
  const theta = Math.atan2(cal.cameraHeightM, distanceM);
  const f = focalLengthPx(cal, width);
  const cy = height / 2;
  return cy + f * Math.tan(theta - (cal.tiltDeg * Math.PI) / 180);
}

/**
 * Convert a vertical wall extent to wave height.
 * The lower ray meets the sea at Z; the upper ray meets the vertical wall top.
 */
export function wallPixelsToHeightM(
  lowerY: number,
  upperY: number,
  width: number,
  height: number,
  cal: Calibration,
): number | null {
  const z = rowToDistanceM(lowerY, width, height, cal);
  const upperAngle = rayDownAngleRad(upperY, width, height, cal);
  if (!Number.isFinite(z) || upperAngle <= -0.02) return null;
  const topHeightM = cal.cameraHeightM - z * Math.tan(upperAngle);
  if (!Number.isFinite(topHeightM) || topHeightM <= 0 || topHeightM > cal.cameraHeightM * 1.2) return null;
  return topHeightM;
}

export function speedToDepthM(speedMs: number): number {
  return (speedMs * speedMs) / GRAVITY;
}

export function depthToSpeedMs(depthM: number): number {
  return Math.sqrt(GRAVITY * depthM);
}

export function linearFit(points: Array<{ x: number; y: number }>): { slope: number; intercept: number; rms: number } | null {
  if (points.length < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const n = points.length;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  let residual = 0;
  for (const p of points) {
    const e = p.y - (slope * p.x + intercept);
    residual += e * e;
  }
  return { slope, intercept, rms: Math.sqrt(residual / n) };
}

export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function mean(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function confidenceLabel(c: number): { text: string; cls: string } {
  if (c >= 0.78) return { text: '高可信', cls: 'ok' };
  if (c >= 0.55) return { text: '可信度中等', cls: 'warn' };
  return { text: '可信度降低', cls: 'bad' };
}

export function formatClock(secondsFromMidnight: number): string {
  const s = Math.max(0, Math.floor(secondsFromMidnight));
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
