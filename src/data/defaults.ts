import type { Calibration } from '../types';

export const defaultCalibration: Calibration = {
  imageWidth: 640,
  imageHeight: 360,
  cameraHeightM: 9.2,
  tiltDeg: 10.5,
  horizontalFovDeg: 64,
  reef: { x: 0.58, y: 0.68 },
  reefDepthM: 3.2,
  calibratedAt: '2026-11-25T20:10:00+08:00',
};

export const weatherLabels: Record<string, string> = {
  clear: '晴/多云',
  rain: '下雨',
  backlight: '逆光',
  fog: '雾',
};

export const directionLabels: Record<string, string> = {
  ltr: '画面左 → 右卷',
  rtl: '画面右 → 左卷',
  unknown: '方向待确认',
};

export const levelLabels: Record<string, string> = {
  good: '适合冲浪',
  marginal: '一般/需选浪',
  poor: '不建议',
  unsafe: '浪大风险',
};
