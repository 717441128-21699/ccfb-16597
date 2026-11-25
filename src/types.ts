export type ID = string;

export type WeatherCondition = 'clear' | 'rain' | 'backlight' | 'fog';

export type Direction = 'ltr' | 'rtl' | 'unknown';

export type SurfLevel = 'good' | 'marginal' | 'poor' | 'unsafe';

export interface NormalizedPoint {
  x: number;
  y: number;
}

/** All geometric quantities are entered in a 640×360 reference frame. */
export interface Calibration {
  imageWidth: number;
  imageHeight: number;
  cameraHeightM: number;
  tiltDeg: number;
  horizontalFovDeg: number;
  reef: NormalizedPoint;
  reefDepthM: number;
  knownMarkerLengthM?: number;
  knownMarkerLengthPx?: number;
  calibratedAt?: string;
}

export type VideoSourceKind = 'sample' | 'upload' | 'stream';

export interface CameraInfo {
  id: ID;
  name: string;
  beach: string;
  sourceKind: VideoSourceKind;
  src: string;
  poster?: string;
  sampleId?: string;
  enabled: boolean;
  weather: WeatherCondition;
  calibration: Calibration;
  notes?: string;
  createdAt: string;
}

export interface CrestPoint {
  x: number;
  y: number;
}

export interface CrestLine {
  id: string;
  trackId?: number;
  points: CrestPoint[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  slope: number;
  intercept: number;
  centerX: number;
  centerY: number;
  yAtReef: number;
  area: number;
  lengthPx: number;
  thicknessPx: number;
  residualPx: number;
  wallHeightPx: number | null;
  wallBaseY: number | null;
  heightM: number | null;
  detectionConfidence: number;
}

export interface FrameQuality {
  meanLuma: number;
  contrast: number;
  whiteRatio: number;
  rainScore: number;
  glareScore: number;
  confidenceFactor: number;
  flags: string[];
}

export interface FrameDetection {
  timeSec: number;
  frameNo: number;
  lines: CrestLine[];
  quality: FrameQuality;
  processingMs: number;
}

export interface WaveMeasurement {
  index: number;
  trackId: number;
  crossingSec: number;
  clockTime?: string;
  periodS: number | null;
  heightM: number;
  speedMs: number;
  depthM: number;
  direction: Direction;
  peelRatePxS?: number;
  confidence: number;
  samples: number;
  line?: CrestLine;
}

export interface ConditionPoint {
  time: string;
  hour: number;
  heightM: number;
  periodS: number;
  depthM: number;
  confidence: number;
  surfScore: number;
  waveCount: number;
}

export interface SurfAssessment {
  score: number;
  level: SurfLevel;
  rideable: boolean;
  direction: Direction;
  reasons: string[];
}

export interface AnalysisSummary {
  id: ID;
  cameraId: ID;
  cameraName: string;
  sampleId?: string;
  sourceName: string;
  startedAt: string;
  videoDurationSec: number;
  analyzedVideoSec: number;
  processedFrames: number;
  skippedFrames: number;
  elapsedMs: number;
  realtimeFactor: number;
  averageFps: number;
  periodS: number | null;
  heightM: number | null;
  speedMs: number | null;
  depthM: number | null;
  direction: Direction;
  confidence: number;
  weather: WeatherCondition;
  qualityFlags: string[];
  surf: SurfAssessment;
  waves: WaveMeasurement[];
  curve: ConditionPoint[];
  lines?: CrestLine[][];
}

export interface TruthWave {
  index: number;
  crossingSec: number;
  periodS: number;
  heightM: number;
  speedMs: number;
  depthM: number;
  direction: Direction;
}

export interface SampleTruth {
  id: string;
  name: string;
  file: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  weather: WeatherCondition;
  calibration: Calibration;
  buoy: {
    station: string;
    periodS: number;
    significantHeightM: number;
    depthM: number;
  };
  chart: {
    source: string;
    reefDepthM: number;
    toleranceM: number;
  };
  waves: TruthWave[];
  meanPeriodS: number;
  meanHeightM: number;
  meanDepthM: number;
  direction: Direction;
}

export interface TruthFile {
  version: number;
  generatedAt: string;
  samples: SampleTruth[];
}
