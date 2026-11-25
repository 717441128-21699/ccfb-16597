import type {
  AnalysisSummary,
  Calibration,
  ConditionPoint,
  CrestLine,
  Direction,
  FrameDetection,
  SurfAssessment,
  WaveMeasurement,
  WeatherCondition,
} from '../types';
import { analyzeFrame, type PixelFrame } from './detector';
import { linearFit, median, rowToDistanceM, speedToDepthM } from './geometry';

interface TrackObservation {
  t: number;
  x: number;
  y: number;
  yReef: number;
  slope: number;
  confidence: number;
  heightM: number | null;
  baseYReef: number | null;
  line: CrestLine;
}

interface Track {
  id: number;
  observations: TrackObservation[];
  lastMatchedFrame: number;
  crossingSec: number | null;
  crossingConfidence: number;
  counted: boolean;
}

export interface PipelineOptions {
  cameraId: string;
  cameraName: string;
  sourceName: string;
  sampleId?: string;
  videoDurationSec: number;
  startedAt?: string;
  weather: WeatherCondition;
  clockStartSec?: number;
}

const MIN_PERIOD_SEC = 5;
const DUPLICATE_CROSSING_SEC = 3.8;

export class SurfPipeline {
  private cal: Calibration;
  private options: PipelineOptions;
  private tracks: Track[] = [];
  private nextTrackId = 1;
  private frameCount = 0;
  private detections: FrameDetection[] = [];
  private qualityFlags = new Set<string>();
  private confidenceSamples: number[] = [];
  private startedWall = performance.now();
  private viewWidth = 480;
  private viewHeight = 270;

  constructor(cal: Calibration, options: PipelineOptions) {
    this.cal = cal;
    this.options = options;
  }

  process(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, timeSec: number): FrameDetection {
    this.frameCount++;
    this.viewWidth = width;
    this.viewHeight = height;
    const pixel: PixelFrame = {
      data: rgba,
      width,
      height,
      timeSec,
      frameNo: this.frameCount,
      weather: this.options.weather,
    };
    const detection = analyzeFrame(pixel, this.cal, this.options.weather);
    this.detections.push(detection);
    this.confidenceSamples.push(detection.quality.confidenceFactor);
    detection.quality.flags.forEach((f) => this.qualityFlags.add(f));
    this.associate(detection, height);
    return detection;
  }

  private associate(detection: FrameDetection, height: number): void {
    const reefY = this.cal.reef.y * height;
    const matchedLines = new Set<string>();
    const maxJump = Math.max(20, height * 0.11);

    for (const track of this.tracks) {
      if (track.crossingSec !== null) continue;
      const last = track.observations[track.observations.length - 1];
      if (!last) continue;
      const dt = detection.timeSec - last.t;
      if (dt > 2.1) continue;
      const predictedY = last.yReef + Math.max(0, dt) * this.estimateTrackVelocity(track);
      let best: CrestLine | null = null;
      let bestCost = Infinity;

      for (const line of detection.lines) {
        if (matchedLines.has(line.id)) continue;
        const yDiff = Math.abs(line.yAtReef - predictedY);
        const rawDiff = Math.abs(line.yAtReef - last.yReef);
        if (rawDiff > maxJump && yDiff > maxJump * 1.35) continue;
        const xDiff = Math.abs(line.centerX - last.x) / Math.max(1, detection.lines[0]?.x2 ?? 1);
        const cost = yDiff + xDiff * 24 + (1 - line.detectionConfidence) * 12;
        if (cost < bestCost) {
          bestCost = cost;
          best = line;
        }
      }

      if (best) {
        matchedLines.add(best.id);
        track.lastMatchedFrame = detection.frameNo;
        track.observations.push({
          t: detection.timeSec,
          x: best.centerX,
          y: best.centerY,
          yReef: best.yAtReef,
          slope: best.slope,
          confidence: best.detectionConfidence,
          heightM: best.heightM,
          baseYReef: best.wallBaseY,
          line: best,
        });
        this.detectCrossing(track, reefY);
      }
    }

    for (const line of detection.lines) {
      if (matchedLines.has(line.id)) continue;
      const track: Track = {
        id: this.nextTrackId++,
        observations: [
          {
            t: detection.timeSec,
            x: line.centerX,
            y: line.centerY,
            yReef: line.yAtReef,
            slope: line.slope,
            confidence: line.detectionConfidence,
            heightM: line.heightM,
            baseYReef: line.wallBaseY,
            line,
          },
        ],
        lastMatchedFrame: detection.frameNo,
        crossingSec: null,
        crossingConfidence: 0,
        counted: false,
      };
      this.tracks.push(track);
    }

    this.tracks = this.tracks.filter((t) => {
      if (t.crossingSec !== null) return true;
      const last = t.observations[t.observations.length - 1];
      return last && detection.timeSec - last.t < 2.1;
    });
  }

  private estimateTrackVelocity(track: Track): number {
    const obs = track.observations;
    if (obs.length < 2) return 18;
    const recent = obs.slice(-5);
    const fit = linearFit(recent.map((o) => ({ x: o.t, y: o.yReef })));
    return fit ? Math.max(2, Math.min(80, fit.slope)) : 18;
  }

  private detectCrossing(track: Track, reefY: number): void {
    if (track.crossingSec !== null) return;
    const obs = track.observations;
    if (obs.length < 3) return;
    const prev = obs[obs.length - 2];
    const cur = obs[obs.length - 1];
    if (prev.yReef < reefY && cur.yReef >= reefY) {
      const ratio = (reefY - prev.yReef) / (cur.yReef - prev.yReef);
      track.crossingSec = prev.t + Math.max(0, Math.min(1, ratio)) * (cur.t - prev.t);
      track.crossingConfidence = median(obs.map((o) => o.confidence)) ?? 0.5;
    } else if (obs.length >= 4 && cur.yReef >= reefY && Math.abs(cur.yReef - reefY) < 13) {
      // Track may initialize immediately above the reef.
      const first = obs[0];
      const fit = linearFit(obs.map((o) => ({ x: o.t, y: o.yReef })));
      if (fit && fit.slope > 2) {
        const t = (reefY - fit.intercept) / fit.slope;
        if (t >= first.t - 1.2 && t <= cur.t + 0.2) {
          track.crossingSec = t;
          track.crossingConfidence = (median(obs.map((o) => o.confidence)) ?? 0.5) * 0.82;
        }
      }
    }
  }

  private crossingEvents(): Array<{ t: number; track: Track; confidence: number }> {
    const events = this.tracks
      .filter((t) => t.crossingSec !== null && t.observations.length >= 4)
      .map((track) => ({ t: track.crossingSec as number, track, confidence: track.crossingConfidence }))
      .sort((a, b) => a.t - b.t);

    // A fragmented crest can yield two nearby tracks. Retain the stronger/longer one.
    const merged: typeof events = [];
    for (const ev of events) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(ev.t - last.t) < DUPLICATE_CROSSING_SEC) {
        const evScore = ev.confidence + Math.min(ev.track.observations.length, 12) * 0.025;
        const lastScore = last.confidence + Math.min(last.track.observations.length, 12) * 0.025;
        if (evScore > lastScore) merged[merged.length - 1] = ev;
      } else {
        merged.push(ev);
      }
    }
    return merged;
  }

  private trackSpeed(track: Track, width: number, height: number): number | null {
    const reefY = this.cal.reef.y * height;
    const withBase = track.observations.filter((o) => o.baseYReef !== null);
    const baseNearReef = withBase.filter((o) => Math.abs((o.baseYReef as number) - reefY) < height * 0.2);
    const baseSource = baseNearReef.length >= 5 ? baseNearReef : withBase.length >= 5 ? withBase : null;
    const source = baseSource ?? track.observations.filter((o) => Math.abs(o.yReef - reefY) < height * 0.18);
    const points = source
      .map((o) => ({ x: o.t, y: rowToDistanceM(o.baseYReef ?? o.yReef, width, height, this.cal) }))
      .filter((p) => Number.isFinite(p.y) && p.y > 1 && p.y < 200);
    const fit = linearFit(points);
    if (!fit) return null;
    const speed = -fit.slope;
    if (speed < 1.2 || speed > 14) {
      // Local pixel velocity converted at the reef is a useful fallback.
      const px = linearFit(source.slice(-7).map((o) => ({ x: o.t, y: o.baseYReef ?? o.yReef })));
      if (!px || px.slope <= 0) return null;
      const z1 = rowToDistanceM(reefY - 4, width, height, this.cal);
      const z2 = rowToDistanceM(reefY + 4, width, height, this.cal);
      const mPerPx = Math.abs(z2 - z1) / 8;
      const fallback = px.slope * mPerPx;
      return fallback >= 1.2 && fallback <= 14 ? fallback : null;
    }
    return speed;
  }

  private trackDirection(track: Track, width: number): { direction: Direction; peelRate: number | null } {
    if (track.observations.length < 4) return { direction: 'unknown', peelRate: null };
    const fit = linearFit(track.observations.map((o) => ({ x: o.t, y: o.x })));
    if (!fit) return { direction: 'unknown', peelRate: null };
    const threshold = width * 0.025; // px/sec at processing resolution
    if (fit.slope > threshold) return { direction: 'ltr', peelRate: fit.slope };
    if (fit.slope < -threshold) return { direction: 'rtl', peelRate: Math.abs(fit.slope) };
    return { direction: 'unknown', peelRate: Math.abs(fit.slope) };
  }

  finish(processedFrames: number, skippedFrames: number, elapsedMs?: number): AnalysisSummary {
    const width = this.viewWidth;
    const height = this.viewHeight;
    const events = this.crossingEvents();
    const waves: WaveMeasurement[] = [];
    const intervals: number[] = [];
    const speeds: number[] = [];
    const heights: number[] = [];
    const depths: number[] = [];
    const directionVotes: Record<Direction, number> = { ltr: 0, rtl: 0, unknown: 0 };
    const peelRates: number[] = [];

    events.forEach((ev, index) => {
      const prev = index > 0 ? events[index - 1].t : null;
      let period: number | null = null;
      if (prev !== null) {
        period = ev.t - prev;
        if (period >= MIN_PERIOD_SEC && period <= 24) intervals.push(period);
        else period = null;
      }
      const speed = this.trackSpeed(ev.track, width, height);
      const dir = this.trackDirection(ev.track, width);
      const trackHeights = ev.track.observations
        .filter((o) => o.heightM !== null && Math.abs(o.yReef - this.cal.reef.y * height) < height * 0.13)
        .map((o) => o.heightM as number);
      const heightM = median(trackHeights) ?? median(ev.track.observations.map((o) => o.heightM).filter(Boolean) as number[]);
      const depthM = speed ? speedToDepthM(speed) : null;
      const confidence = Math.max(0.2, Math.min(0.98, ev.confidence * (period ? 1 : 0.86) * (heightM ? 1 : 0.72) * (speed ? 1 : 0.7)));

      directionVotes[dir.direction] += confidence;
      if (dir.peelRate) peelRates.push(dir.peelRate);
      if (speed) speeds.push(speed);
      if (heightM) heights.push(heightM);
      if (depthM && depthM > 0.4 && depthM < 12) depths.push(depthM);

      waves.push({
        index: index + 1,
        trackId: ev.track.id,
        crossingSec: ev.t,
        clockTime: this.options.clockStartSec !== undefined ? formatClockSec(this.options.clockStartSec + ev.t) : undefined,
        periodS: period,
        heightM: heightM ? round(heightM, 2) : 0,
        speedMs: speed ? round(speed, 2) : 0,
        depthM: depthM ? round(depthM, 2) : 0,
        direction: dir.direction,
        peelRatePxS: dir.peelRate ? round(dir.peelRate, 1) : undefined,
        confidence: round(confidence, 2),
        samples: ev.track.observations.length,
        line: ev.track.observations[ev.track.observations.length - 1]?.line,
      });
    });

    // Fill a robust median period even if one interval was outlier-filtered.
    const periodS = median(intervals);
    const heightM = median(heights);
    const speedMs = median(speeds);
    const depthM = median(depths);
    const direction: Direction =
      directionVotes.ltr === directionVotes.rtl ? 'unknown' : directionVotes.ltr > directionVotes.rtl ? 'ltr' : 'rtl';
    const qualityFactor = median(this.confidenceSamples) ?? 0.8;
    const countFactor = Math.min(1, waves.length / 5 + 0.35);
    const confidence = round(Math.max(0.18, Math.min(0.96, qualityFactor * countFactor * (periodS ? 1 : 0.72))), 2);
    const surf = assessSurf(heightM, periodS, direction, confidence, this.options.weather);
    const elapsed = elapsedMs ?? performance.now() - this.startedWall;
    const analyzedVideoSec = this.detections.length
      ? this.detections[this.detections.length - 1].timeSec - this.detections[0].timeSec
      : 0;

    return {
      id: `an-${Date.now?.() ?? 0}-${Math.round(elapsed)}`,
      cameraId: this.options.cameraId,
      cameraName: this.options.cameraName,
      sampleId: this.options.sampleId,
      sourceName: this.options.sourceName,
      startedAt: this.options.startedAt ?? new Date(0).toISOString(),
      videoDurationSec: this.options.videoDurationSec,
      analyzedVideoSec: Math.max(0, analyzedVideoSec),
      processedFrames,
      skippedFrames,
      elapsedMs: Math.round(elapsed),
      realtimeFactor: round(this.options.videoDurationSec / Math.max(1, elapsed / 1000), 1),
      averageFps: round(processedFrames / Math.max(0.001, elapsed / 1000), 1),
      periodS: periodS ? round(periodS, 2) : null,
      heightM: heightM ? round(heightM, 2) : null,
      speedMs: speedMs ? round(speedMs, 2) : null,
      depthM: depthM ? round(depthM, 2) : null,
      direction,
      confidence,
      weather: this.options.weather,
      qualityFlags: Array.from(this.qualityFlags),
      surf,
      waves,
      curve: buildCurve(waves, this.options.clockStartSec ?? 6 * 3600),
    };
  }
}

export function assessSurf(
  heightM: number | null,
  periodS: number | null,
  direction: Direction,
  confidence: number,
  weather: WeatherCondition,
): SurfAssessment {
  const reasons: string[] = [];
  let score = 52;
  if (heightM === null) {
    reasons.push('未稳定测得波高，建议人工复核');
    score -= 18;
  } else if (heightM < 0.6) {
    reasons.push(`浪高约 ${heightM.toFixed(1)} m，推力偏弱`);
    score -= 24;
  } else if (heightM <= 1.8) {
    reasons.push(`浪高 ${heightM.toFixed(1)} m，适合多数会员练习`);
    score += 20;
  } else if (heightM <= 2.6) {
    reasons.push(`浪高 ${heightM.toFixed(1)} m，有力，建议中级以上`);
    score += 12;
  } else {
    reasons.push(`浪高 ${heightM.toFixed(1)} m，偏大，不适合普通外地会员`);
    score -= 20;
  }

  if (periodS === null) {
    reasons.push('周期样本不足');
    score -= 10;
  } else if (periodS >= 10) {
    reasons.push(`周期 ${periodS.toFixed(1)} s，涌浪能量充足`);
    score += 16;
  } else if (periodS >= 7) {
    reasons.push(`周期 ${periodS.toFixed(1)} s，可玩但力量中等`);
    score += 7;
  } else {
    reasons.push(`周期仅 ${periodS.toFixed(1)} s，近岸碎浪偏软`);
    score -= 12;
  }

  if (direction === 'unknown') {
    reasons.push('卷浪方向不明确，可能是闭合浪或视角不足');
    score -= 8;
  } else {
    reasons.push(direction === 'ltr' ? '浪壁从画面左侧向右卷，有可滑行切面' : '浪壁从画面右侧向左卷，有可滑行切面');
    score += 8;
  }
  if (confidence < 0.6 || weather === 'rain' || weather === 'backlight') {
    reasons.push('天气/光照使可信度降低，播报中应提示现场复核');
    score -= 10;
  }

  score = Math.max(5, Math.min(98, Math.round(score)));
  let level: SurfAssessment['level'] = 'marginal';
  if (score >= 76 && (heightM ?? 0) <= 2.4) level = 'good';
  else if (score >= 55) level = 'marginal';
  else if ((heightM ?? 0) > 2.6) level = 'unsafe';
  else level = 'poor';
  return {
    score,
    level,
    rideable: score >= 58 && direction !== 'unknown' && (heightM ?? 0) >= 0.7,
    direction,
    reasons,
  };
}

export function buildCurve(waves: WaveMeasurement[], clockStartSec: number): ConditionPoint[] {
  if (!waves.length) return [];
  const bucketSec = 30 * 60;
  const startClock = clockStartSec;
  const buckets = new Map<number, WaveMeasurement[]>();
  for (const w of waves) {
    const clock = startClock + w.crossingSec;
    const hour = Math.floor(clock / 3600);
    const key = Math.floor(clock / bucketSec);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(w);
    void hour;
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([key, ws]) => {
      const heights = ws.map((w) => w.heightM).filter(Boolean);
      const periods = ws.map((w) => w.periodS).filter((p): p is number => p !== null);
      const conf = ws.map((w) => w.confidence);
      const heightM = median(heights) ?? 0;
      const periodS = median(periods) ?? 0;
      const depthM = median(ws.map((w) => w.depthM).filter(Boolean)) ?? 0;
      const confidence = median(conf) ?? 0.5;
      const clockSec = key * bucketSec;
      const surf = assessSurf(heightM || null, periodS || null, ws[ws.length - 1]?.direction ?? 'unknown', confidence, 'clear');
      return {
        time: formatClockSec(clockSec),
        hour: clockSec / 3600,
        heightM: round(heightM, 2),
        periodS: periodS ? round(periodS, 2) : 0,
        depthM: round(depthM, 2),
        confidence: round(confidence, 2),
        surfScore: surf.score,
        waveCount: ws.length,
      };
    });
}

function round(v: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function formatClockSec(sec: number): string {
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}
