import type { Calibration, Direction, SampleTruth, WeatherCondition } from '../src/types';
import { depthToSpeedMs } from '../src/lib/geometry';

export const SAMPLE_WIDTH = 640;
export const SAMPLE_HEIGHT = 360;
export const SAMPLE_FPS = 12;

export interface SampleScenario {
  id: string;
  name: string;
  description: string;
  file: string;
  durationSec: number;
  periodS: number;
  heightM: number;
  depthM: number;
  direction: Direction;
  weather: WeatherCondition;
  slope: number;
  peelPxPerSec: number;
  seed: number;
  clockStartSec: number;
}

export const defaultCalibration: Calibration = {
  imageWidth: SAMPLE_WIDTH,
  imageHeight: SAMPLE_HEIGHT,
  cameraHeightM: 9.2,
  tiltDeg: 10.5,
  horizontalFovDeg: 64,
  reef: { x: 0.58, y: 0.68 },
  reefDepthM: 3.2,
  calibratedAt: '2026-11-26T06:00:00+08:00',
};

export const scenarios: SampleScenario[] = [
  {
    id: 'clean-ltr',
    name: '清水点 · 左卷',
    description: '8.5 秒小涌，晴，浪从左向右卷，适合练习',
    file: 'clean-ltr.mp4',
    durationSec: 72,
    periodS: 8.5,
    heightM: 1.15,
    depthM: 2.9,
    direction: 'ltr',
    weather: 'clear',
    slope: 0.16,
    peelPxPerSec: 46,
    seed: 101,
    clockStartSec: 6 * 3600 + 20 * 60,
  },
  {
    id: 'long-rtl',
    name: '南礁 · 右卷长涌',
    description: '12 秒长涌，1.8 米，晴到多云，能量好',
    file: 'long-rtl.mp4',
    durationSec: 84,
    periodS: 12,
    heightM: 1.8,
    depthM: 4.0,
    direction: 'rtl',
    weather: 'clear',
    slope: -0.18,
    peelPxPerSec: 38,
    seed: 202,
    clockStartSec: 7 * 3600 + 5 * 60,
  },
  {
    id: 'heavy-rain-ltr',
    name: '北滩 · 雨中涌',
    description: '14 秒涌浪，2.4 米，阵雨，系统应降低可信度',
    file: 'heavy-rain-ltr.mp4',
    durationSec: 84,
    periodS: 14,
    heightM: 2.35,
    depthM: 4.8,
    direction: 'ltr',
    weather: 'rain',
    slope: 0.2,
    peelPxPerSec: 34,
    seed: 303,
    clockStartSec: 8 * 3600,
  },
  {
    id: 'backlight-rtl',
    name: '西壁 · 逆光碎浪',
    description: '7.5 秒近岸浪，0.85 米，傍晚逆光，应标出眩光',
    file: 'backlight-rtl.mp4',
    durationSec: 60,
    periodS: 7.5,
    heightM: 0.9,
    depthM: 2.3,
    direction: 'rtl',
    weather: 'backlight',
    slope: -0.14,
    peelPxPerSec: 52,
    seed: 404,
    clockStartSec: 17 * 3600 + 40 * 60,
  },
];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function focal(cal: Calibration, width = cal.imageWidth): number {
  return width / (2 * Math.tan((cal.horizontalFovDeg * Math.PI) / 360));
}
function cyFor(cal: Calibration, width = cal.imageWidth): number {
  return (cal.imageHeight / 2) * (width / cal.imageWidth);
}
function rowForZ(z: number, cal: Calibration, width = cal.imageWidth): number {
  const theta = Math.atan2(cal.cameraHeightM, z);
  return cyFor(cal, width) + focal(cal, width) * Math.tan(theta - (cal.tiltDeg * Math.PI) / 180);
}
function zForRow(y: number, cal: Calibration, width = cal.imageWidth): number {
  const theta = (cal.tiltDeg * Math.PI) / 180 + Math.atan((y - cyFor(cal, width)) / focal(cal, width));
  return theta > 0.001 ? cal.cameraHeightM / Math.tan(theta) : Infinity;
}
function lipRow(baseY: number, heightM: number, cal: Calibration): number {
  const z = zForRow(baseY, cal);
  if (!Number.isFinite(z)) return baseY - 20;
  const alpha = Math.atan2(Math.max(0.5, cal.cameraHeightM - heightM), z);
  return cyFor(cal) + focal(cal) * Math.tan(alpha - (cal.tiltDeg * Math.PI) / 180);
}

function mix(a: number[], b: number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function setPx(buf: Buffer | Uint8Array, w: number, x: number, y: number, rgb: number[], alpha = 1): void {
  const xi = x | 0;
  const yi = y | 0;
  if (xi < 0 || xi >= w || yi < 0 || yi >= 360) return;
  const i = (yi * w + xi) * 3;
  if (i + 2 >= buf.length) return;
  if (alpha >= 1) {
    buf[i] = rgb[0];
    buf[i + 1] = rgb[1];
    buf[i + 2] = rgb[2];
  } else {
    buf[i] = buf[i] * (1 - alpha) + rgb[0] * alpha;
    buf[i + 1] = buf[i + 1] * (1 - alpha) + rgb[1] * alpha;
    buf[i + 2] = buf[i + 2] * (1 - alpha) + rgb[2] * alpha;
  }
}

function drawRock(buf: Buffer, w: number, h: number, reefX: number, reefY: number, rnd: () => number): void {
  for (let y = reefY - 4; y < reefY + 25; y++) {
    for (let x = reefX - 34; x < reefX + 38; x++) {
      const dx = (x - reefX - 4) / 34;
      const dy = (y - reefY - 12) / 13;
      if (dx * dx + dy * dy < 1) {
        const shade = 42 + rnd() * 28 + (y < reefY + 8 ? 12 : 0);
        setPx(buf, w, x, y, [shade * 0.9, shade * 0.98, shade + 8]);
      }
    }
  }
  void h;
}

export function renderFrameRgb(scenario: SampleScenario, timeSec: number, frameNo: number, width = SAMPLE_WIDTH, height = SAMPLE_HEIGHT): Buffer {
  const buf = Buffer.alloc(width * height * 3);
  const cal = { ...defaultCalibration, imageWidth: SAMPLE_WIDTH, imageHeight: SAMPLE_HEIGHT };
  const scale = width / SAMPLE_WIDTH;
  const reefX = cal.reef.x * width;
  const reefY = cal.reef.y * height;
  const horizonY = cyFor(cal, width) - focal(cal, width) * Math.tan((cal.tiltDeg * Math.PI) / 180);
  const rnd = mulberry32(scenario.seed * 100003 + frameNo * 9176);

  // Sky and sea.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rgb: [number, number, number];
      if (y < horizonY) {
        const t = y / Math.max(1, horizonY);
        rgb = mix([91, 178, 219], [214, 240, 250], t);
      } else {
        const t = Math.min(1, (y - horizonY) / (height - horizonY));
        rgb = mix([31, 111, 151], [7, 67, 101], t);
        const band = Math.sin(y * 0.23 + Math.sin(x * 0.035) * 2.2) * 5;
        const n = (rnd() - 0.5) * 9 + band;
        rgb = [rgb[0] + n * 0.55, rgb[1] + n, rgb[2] + n * 1.15];
      }
      if (scenario.weather === 'backlight') {
        rgb = [rgb[0] + 24, rgb[1] + 18, rgb[2] + 4];
      }
      const i = (y * width + x) * 3;
      buf[i] = Math.max(0, Math.min(255, rgb[0]));
      buf[i + 1] = Math.max(0, Math.min(255, rgb[1]));
      buf[i + 2] = Math.max(0, Math.min(255, rgb[2]));
    }
  }

  // Sun glare for backlight.
  if (scenario.weather === 'backlight') {
    const sx = width * 0.72;
    const sy = horizonY + 18 * scale;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const d = Math.hypot((x - sx) * 0.7, y - sy);
        if (d < 150 * scale) {
          const a = Math.max(0, 0.34 * (1 - d / (150 * scale)));
          setPx(buf, width, x, y, [255, 236, 178], a);
        }
      }
    }
  }

  drawRock(buf, width, height, reefX, reefY, rnd);

  const speed = depthToSpeedMs(scenario.depthM);
  const zReef = zForRow(reefY / scale * scale, cal) ; // reefY already scaled but cal fn width? use scaled helper below
  const zr = cal.cameraHeightM / Math.tan((cal.tiltDeg * Math.PI) / 180 + Math.atan((reefY - cyFor(cal, width)) / focal(cal, width)));
  void zReef;

  const firstCross = 5;
  const crossings: number[] = [];
  for (let k = 0; ; k++) {
    const tc = firstCross + k * scenario.periodS;
    if (tc > scenario.durationSec + 4) break;
    crossings.push(tc);
  }

  for (let wi = 0; wi < crossings.length; wi++) {
    const tc = crossings[wi];
    const dt = timeSec - tc;
    const zCenter = zr + speed * (tc - timeSec);
    if (zCenter < 4 || zCenter > 170) continue;
    const waveVariation = 1 + 0.075 * Math.sin(wi * 1.73 + scenario.seed * 0.01);
    const approach = Math.max(0, Math.min(1, (dt + 11) / 8.5));
    const decay = dt > 1.5 ? Math.max(0, 0.82 - (dt - 1.5) / 9) : 1;
    const h = scenario.heightM * waveVariation * (0.48 + 0.52 * approach) * decay;
    if (h < 0.22) continue;
    const baseCenterY = rowForZ(zCenter, cal, width);
    if (baseCenterY < horizonY - 20 || baseCenterY > height + 50) continue;
    const slope = scenario.slope * scale;
    const xMin = Math.max(2, reefX - 285 * scale);
    const xMax = Math.min(width - 3, reefX + 285 * scale);

    // Steep wave wall.
    for (let x = xMin; x <= xMax; x++) {
      const yb = baseCenterY + slope * (x - reefX) / scale;
      if (yb < horizonY + 2 || yb > height - 2) continue;
      const z = zForRow(yb, cal, width);
      if (!Number.isFinite(z)) continue;
      const ytScaled = lipRow((yb / height) * SAMPLE_HEIGHT, h, cal) * scale;
      const yt = ytScaled / scale * scale; // lipRow reference coordinates then scale
      const wallTop = Math.max(0, yt);
      const wallBottom = Math.min(height - 1, yb);
      for (let y = wallTop; y <= wallBottom; y++) {
        const q = (y - wallTop) / Math.max(1, wallBottom - wallTop);
        const streak = Math.sin(x * 0.11 + wi * 2.1) * 9 + Math.sin((x + y) * 0.047) * 6;
        let rgb = mix([54, 166, 164], [5, 55, 88], Math.pow(q, 0.72));
        const noise = (rnd() - 0.5) * 12 + streak;
        rgb = [rgb[0] + noise, rgb[1] + noise, rgb[2] + noise * 0.7];
        setPx(buf, width, x, y, rgb);
      }
      // Dark trough/base shadow.
      for (let y = wallBottom - 2 * scale; y <= wallBottom + 1; y++) {
        setPx(buf, width, x, y, [3, 31, 52], 0.72);
      }
    }

    // White foam lip, peeling segment.
    const dir = scenario.direction === 'ltr' ? 1 : -1;
    const peelX = reefX + dir * scenario.peelPxPerSec * scale * dt;
    const foamHalf = 82 * scale;
    const foamThickness = (4.8 + Math.min(5, Math.max(0, dt) * 0.9)) * scale;
    for (let x = Math.max(2, peelX - foamHalf); x <= Math.min(width - 3, peelX + foamHalf); x++) {
      if (x < 0 || x >= width) continue;
      const yb = baseCenterY + slope * (x - reefX) / scale;
      const ytRef = lipRow((yb / height) * SAMPLE_HEIGHT, h, cal);
      const yLip = ytRef * scale;
      const edgeNoise = Math.sin(x * 0.31 + frameNo * 0.7) * 1.7 + (rnd() - 0.5) * 2.2;
      for (let dy = -foamThickness; dy <= foamThickness + 2 * scale; dy++) {
        const y = yLip + dy + edgeNoise;
        const edge = 1 - Math.abs(dy) / (foamThickness + 2 * scale);
        if (edge <= 0 && rnd() > 0.18) continue;
        const speck = rnd();
        if (speck < 0.08 && edge < 0.7) continue;
        const white = 218 + 34 * Math.max(0, edge) + rnd() * 8;
        setPx(buf, width, x, y, [white, Math.min(255, white + 3), 255], Math.min(1, 0.55 + edge * 0.5));
      }
    }

    // Sparse foam streaks down the wave face after it breaks.
    if (dt > 0.2) {
      for (let s = 0; s < 42 * scale; s++) {
        const x = peelX - foamHalf + rnd() * foamHalf * 2;
        const yb = baseCenterY + slope * (x - reefX) / scale;
        const y = yb - rnd() * Math.max(4, (yb - lipRow((yb / height) * SAMPLE_HEIGHT, h, cal)) * scale);
        setPx(buf, width, x, y, [226, 244, 248], 0.35 + rnd() * 0.35);
      }
    }
  }

  // Rain streaks and tonal reduction.
  if (scenario.weather === 'rain') {
    for (let i = 0; i < width * height * 0.12; i++) {
      const x = Math.floor(rnd() * width);
      const y = Math.floor(rnd() * height);
      const idx = (y * width + x) * 3;
      buf[idx] *= 0.82;
      buf[idx + 1] *= 0.88;
      buf[idx + 2] *= 0.96;
    }
    const streaks = Math.floor(95 * scale);
    for (let s = 0; s < streaks; s++) {
      const x0 = rnd() * width;
      const y0 = rnd() * height;
      const len = 10 + rnd() * 18;
      for (let k = 0; k < len; k++) {
        setPx(buf, width, x0 - k * 0.28, y0 + k, [190, 211, 224], 0.34);
      }
    }
  }

  if (scenario.weather === 'backlight') {
    for (let i = 0; i < buf.length; i += 3) {
      buf[i] = Math.min(255, buf[i] + 10);
      buf[i + 1] = Math.min(255, buf[i + 1] + 7);
      buf[i + 2] = Math.max(0, buf[i + 2] - 8);
    }
  }

  return buf;
}

export function buildTruth(scenario: SampleScenario): SampleTruth {
  const speed = depthToSpeedMs(scenario.depthM);
  const waves = [];
  for (let k = 0; ; k++) {
    const crossingSec = 5 + k * scenario.periodS;
    if (crossingSec > scenario.durationSec - 2) break;
    const variation = 1 + 0.075 * Math.sin(k * 1.73 + scenario.seed * 0.01);
    waves.push({
      index: k + 1,
      crossingSec: round(crossingSec, 2),
      periodS: k === 0 ? scenario.periodS : scenario.periodS,
      heightM: round(scenario.heightM * variation, 2),
      speedMs: round(speed, 2),
      depthM: scenario.depthM,
      direction: scenario.direction,
    });
  }
  const meanHeightM = waves.reduce((a, w) => a + w.heightM, 0) / waves.length;
  return {
    id: scenario.id,
    name: scenario.name,
    file: scenario.file,
    durationSec: scenario.durationSec,
    fps: SAMPLE_FPS,
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
    weather: scenario.weather,
    calibration: defaultCalibration,
    buoy: {
      station: '浮标 OB-07（同步模拟）',
      periodS: scenario.periodS,
      significantHeightM: round(meanHeightM * 0.96, 2),
      depthM: scenario.depthM,
    },
    chart: {
      source: '海图礁区测深格网 2025-Q2',
      reefDepthM: scenario.depthM,
      toleranceM: round(scenario.depthM * 0.25, 2),
    },
    waves,
    meanPeriodS: scenario.periodS,
    meanHeightM: round(meanHeightM, 2),
    meanDepthM: scenario.depthM,
    direction: scenario.direction,
  };
}

function round(v: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}
