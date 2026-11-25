import type { ConditionPoint } from '../types';
import { assessSurf } from '../lib/tracker';

export function buildDemoDay(): ConditionPoint[] {
  const points: ConditionPoint[] = [];
  const startHour = 5.5;
  const endHour = 19.5;
  for (let hour = startHour, i = 0; hour <= endHour + 0.001; hour += 0.5, i++) {
    const climax = Math.exp(-Math.pow(hour - 10.2, 2) / 18);
    const afternoon = Math.exp(-Math.pow(hour - 16.5, 2) / 9) * 0.45;
    const heightM = Math.round((0.82 + 0.72 * climax + 0.34 * afternoon + 0.05 * Math.sin(i * 1.7)) * 100) / 100;
    const periodS = Math.round((8.2 + 3.4 * climax + 1.1 * afternoon + 0.2 * Math.sin(i * 0.9)) * 10) / 10;
    const depthM = Math.round((2.85 + 0.28 * climax) * 100) / 100;
    const rainDip = hour >= 13.5 && hour <= 15.5 ? 0.22 : 0;
    const backlightDip = hour >= 17.2 ? Math.min(0.24, (hour - 17.2) * 0.22) : 0;
    const confidence = Math.round(Math.max(0.48, 0.94 - rainDip - backlightDip - (i % 7 === 0 ? 0.04 : 0)) * 100) / 100;
    const direction = hour < 14 ? 'ltr' : 'rtl';
    const surf = assessSurf(heightM, periodS, direction, confidence, rainDip ? 'rain' : backlightDip ? 'backlight' : 'clear');
    const hh = Math.floor(hour);
    const mm = Math.round((hour - hh) * 60);
    points.push({
      time: `${String(hh).padStart(2, '0')}:${mm === 0 ? '00' : mm}`,
      hour,
      heightM,
      periodS,
      depthM,
      confidence,
      surfScore: surf.score,
      waveCount: 8 + ((i * 5) % 9),
    });
  }
  return points;
}

export function aggregateDay(points: ConditionPoint[]): {
  maxHeight: number;
  meanHeight: number;
  maxPeriod: number;
  meanPeriod: number;
  minConfidence: number;
  best: ConditionPoint | null;
} {
  if (!points.length) {
    return { maxHeight: 0, meanHeight: 0, maxPeriod: 0, meanPeriod: 0, minConfidence: 0, best: null };
  }
  const maxHeight = Math.max(...points.map((p) => p.heightM));
  const meanHeight = points.reduce((a, p) => a + p.heightM, 0) / points.length;
  const maxPeriod = Math.max(...points.map((p) => p.periodS));
  const meanPeriod = points.reduce((a, p) => a + p.periodS, 0) / points.length;
  const minConfidence = Math.min(...points.map((p) => p.confidence));
  const best = points.reduce((best, p) => (p.surfScore > best.surfScore ? p : best), points[0]);
  return { maxHeight, meanHeight, maxPeriod, meanPeriod, minConfidence, best };
}
