import type { AnalysisSummary, CameraInfo, FrameDetection } from '../types';
import AnalysisWorker from '../workers/analysis.worker?worker';

export const PROCESS_WIDTH = 640;
export const PROCESS_HEIGHT = 360;

export interface RunnerHandlers {
  onDetection?: (detection: FrameDetection) => void;
  onProgress?: (ratio: number, currentSec: number) => void;
  onLog?: (message: string, level?: 'ok' | 'warn' | 'bad') => void;
}

export class AnalysisRunner {
  private worker: Worker | null = null;
  private objectUrl: string | null = null;
  private canceled = false;

  cancel(): void {
    this.canceled = true;
    this.worker?.terminate();
    this.worker = null;
  }

  async run(
    video: HTMLVideoElement,
    camera: CameraInfo,
    file: File | null,
    opts: { analysisFps: number; playbackRate: number },
    handlers: RunnerHandlers = {},
  ): Promise<AnalysisSummary> {
    this.canceled = false;
    const log = (m: string, level: 'ok' | 'warn' | 'bad' = 'ok') => handlers.onLog?.(m, level);

    if (file) {
      this.objectUrl = URL.createObjectURL(file);
      video.src = this.objectUrl;
    } else {
      video.src = camera.src;
    }
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.playbackRate = opts.playbackRate;

    await waitForEvent(video, 'loadedmetadata');
    if (this.canceled) throw new DOMException('canceled', 'AbortError');
    video.currentTime = 0;
    await waitForEvent(video, 'seeked');

    const canvas = document.createElement('canvas');
    canvas.width = PROCESS_WIDTH;
    canvas.height = PROCESS_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建处理 Canvas 2D 上下文');

    this.worker = new AnalysisWorker();
    const worker = this.worker!;
    let pending = false;
    let processedFrames = 0;
    let skippedFrames = 0;
    let lastSample = -Infinity;
    let resolveFrame: (() => void) | null = null;
    let summaryResolve: ((s: AnalysisSummary) => void) | null = null;
    let summaryReject: ((e: Error) => void) | null = null;

    const summaryPromise = new Promise<AnalysisSummary>((resolve, reject) => {
      summaryResolve = resolve;
      summaryReject = reject;
    });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as
        | { type: 'ready' }
        | { type: 'detection'; detection: FrameDetection }
        | { type: 'summary'; summary: AnalysisSummary }
        | { type: 'error'; message: string };
      if (msg.type === 'detection') {
        pending = false;
        handlers.onDetection?.(msg.detection);
        const r = resolveFrame;
        resolveFrame = null;
        r?.();
      } else if (msg.type === 'summary') {
        summaryResolve?.(msg.summary);
      } else if (msg.type === 'error') {
        summaryReject?.(new Error(msg.message));
      }
    };
    worker.onerror = (e) => summaryReject?.(new Error(e.message));

    worker.postMessage({
      type: 'start',
      calibration: camera.calibration,
      options: {
        cameraId: camera.id,
        cameraName: camera.name,
        sourceName: file?.name ?? camera.src.split('/').pop() ?? camera.name,
        sampleId: camera.sampleId,
        videoDurationSec: Number.isFinite(video.duration) ? video.duration : 0,
        weather: camera.weather,
        startedAt: new Date().toISOString(),
      },
    });

    const duration = video.duration;
    log(`视频就绪：${duration.toFixed(0)}s，分析采样 ${opts.analysisFps} fps，快速播放 ${opts.playbackRate}×`);
    const startedWall = performance.now();
    await video.play();
    log('Web Worker 浪峰检测/跟踪已启动');

    const sampleInterval = 1 / opts.analysisFps;
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (this.canceled || video.ended || video.currentTime >= duration - 0.03) {
          resolve();
          return;
        }
        const t = video.currentTime;
        if (!pending && t - lastSample >= sampleInterval) {
          if (lastSample > -Infinity && t - lastSample > sampleInterval * 1.8) skippedFrames++;
          lastSample = t;
          ctx.drawImage(video, 0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);
          const image = ctx.getImageData(0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);
          pending = true;
          processedFrames++;
          worker.postMessage(
            { type: 'frame', buffer: image.data.buffer, width: PROCESS_WIDTH, height: PROCESS_HEIGHT, timeSec: t },
            [image.data.buffer],
          );
          handlers.onProgress?.(Math.min(1, t / duration), t);
          if (pending) {
            resolveFrame = () => requestAnimationFrame(tick);
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    video.pause();
    if (pending) {
      await new Promise<void>((resolve) => {
        resolveFrame = resolve;
        setTimeout(resolve, 1500);
      });
    }

    const elapsedMs = performance.now() - startedWall;
    log(`解码/分析完成：${processedFrames} 帧，墙钟 ${(elapsedMs / 1000).toFixed(1)}s；正在汇总周期与水深…`, 'ok');
    worker.postMessage({ type: 'finish', processedFrames, skippedFrames, elapsedMs });
    const summary = await summaryPromise;
    this.cleanup();
    return summary;
  }

  private cleanup(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

function waitForEvent(target: HTMLVideoElement, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      target.removeEventListener(type, onOk);
      target.removeEventListener('error', onErr);
    };
    const onOk = (): void => {
      cleanup();
      resolve();
    };
    const onErr = (): void => {
      cleanup();
      reject(new Error('视频加载失败，请确认 public/samples 已生成或地址可访问'));
    };
    target.addEventListener(type, onOk, { once: true });
    target.addEventListener('error', onErr, { once: true });
  });
}
