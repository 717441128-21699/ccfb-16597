import type { AnalysisSummary, CameraInfo } from '../types';
import { defaultCalibration } from '../data/defaults';

const CAMERA_KEY = 'surfcam.cameras.v1';
const RESULT_KEY = 'surfcam.results.v1';
const SETTINGS_KEY = 'surfcam.settings.v1';

export interface AppSettings {
  clubName: string;
  broadcastGroup: string;
  buoyName: string;
  chartName: string;
  analysisFps: number;
  fastPlaybackRate: number;
}

export const defaultSettings: AppSettings = {
  clubName: '岸瞳冲浪俱乐部',
  broadcastGroup: '会员浪况群',
  buoyName: 'OB-07 浪浮标',
  chartName: '礁区测深图 2025-Q2',
  analysisFps: 3,
  fastPlaybackRate: 16,
};

export const fallbackCameras: CameraInfo[] = [
  {
    id: 'cam-clean-ltr',
    name: '一号塔台',
    beach: '清水点 · 左卷',
    sourceKind: 'sample',
    src: '/samples/clean-ltr.mp4',
    sampleId: 'clean-ltr',
    enabled: true,
    weather: 'clear',
    calibration: defaultCalibration,
    notes: '日常练习主力机位',
    createdAt: '2026-11-25T20:00:00+08:00',
  },
  {
    id: 'cam-long-rtl',
    name: '南礁机位',
    beach: '南礁 · 右卷长涌',
    sourceKind: 'sample',
    src: '/samples/long-rtl.mp4',
    sampleId: 'long-rtl',
    enabled: true,
    weather: 'clear',
    calibration: defaultCalibration,
    createdAt: '2026-11-25T20:00:00+08:00',
  },
  {
    id: 'cam-rain',
    name: '北滩东桩',
    beach: '北滩 · 雨中涌',
    sourceKind: 'sample',
    src: '/samples/heavy-rain-ltr.mp4',
    sampleId: 'heavy-rain-ltr',
    enabled: true,
    weather: 'rain',
    calibration: defaultCalibration,
    notes: '阵雨时镜头沾水，可信度自动降低',
    createdAt: '2026-11-25T20:00:00+08:00',
  },
  {
    id: 'cam-backlight',
    name: '西门栈道',
    beach: '西壁 · 逆光碎浪',
    sourceKind: 'sample',
    src: '/samples/backlight-rtl.mp4',
    sampleId: 'backlight-rtl',
    enabled: true,
    weather: 'backlight',
    calibration: defaultCalibration,
    createdAt: '2026-11-25T20:00:00+08:00',
  },
  {
    id: 'cam-benchmark',
    name: '性能基准机位',
    beach: '十分钟循环涌浪',
    sourceKind: 'sample',
    src: '/samples/benchmark-10m.mp4',
    sampleId: 'benchmark-10m',
    enabled: true,
    weather: 'clear',
    calibration: defaultCalibration,
    notes: '600 秒录像，用于验证一分钟内出结果',
    createdAt: '2026-11-25T20:00:00+08:00',
  },
];

export function uid(prefix = 'id'): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}
function readArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('surfcam-storage', { detail: { key } }));
  } catch (err) {
    console.warn('localStorage write failed', err);
  }
}

export function loadCameras(): CameraInfo[] {
  const cameras = readArray<CameraInfo>(CAMERA_KEY, fallbackCameras);
  return cameras.length ? cameras : fallbackCameras;
}
export function saveCameras(cameras: CameraInfo[]): void {
  write(CAMERA_KEY, cameras);
}
export function upsertCamera(camera: CameraInfo): CameraInfo[] {
  const cameras = loadCameras();
  const idx = cameras.findIndex((c) => c.id === camera.id);
  if (idx >= 0) cameras[idx] = camera;
  else cameras.unshift(camera);
  saveCameras(cameras);
  return cameras;
}
export function deleteCamera(id: string): CameraInfo[] {
  const cameras = loadCameras().filter((c) => c.id !== id);
  saveCameras(cameras);
  return cameras;
}

function sanitizeResult(result: AnalysisSummary): AnalysisSummary {
  return {
    ...result,
    waves: result.waves.map((w) => ({ ...w, line: undefined })),
  };
}

export function loadResults(): AnalysisSummary[] {
  return readArray<AnalysisSummary>(RESULT_KEY, []);
}
export function saveResult(result: AnalysisSummary): AnalysisSummary[] {
  const results = [sanitizeResult(result), ...loadResults()].slice(0, 24);
  write(RESULT_KEY, results);
  return results;
}
export function clearResults(): void {
  write(RESULT_KEY, []);
}

export function loadSettings(): AppSettings {
  return read<AppSettings>(SETTINGS_KEY, defaultSettings);
}
export function saveSettings(settings: AppSettings): AppSettings {
  write(SETTINGS_KEY, settings);
  return settings;
}

export function exportJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
