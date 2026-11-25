/// <reference lib="webworker" />
import { SurfPipeline, type PipelineOptions } from '../lib/tracker';
import type { Calibration, FrameDetection } from '../types';

interface StartMessage {
  type: 'start';
  calibration: Calibration;
  options: PipelineOptions;
}
interface FrameMessage {
  type: 'frame';
  buffer: ArrayBuffer;
  width: number;
  height: number;
  timeSec: number;
}
interface FinishMessage {
  type: 'finish';
  processedFrames: number;
  skippedFrames: number;
  elapsedMs?: number;
}
type Incoming = StartMessage | FrameMessage | FinishMessage | { type: 'reset' };

const workerSelf = self as unknown as DedicatedWorkerGlobalScope;
let pipeline: SurfPipeline | null = null;
let startedWall = 0;

workerSelf.onmessage = (event: MessageEvent<Incoming>) => {
  const msg = event.data;
  try {
    if (msg.type === 'start') {
      pipeline = new SurfPipeline(msg.calibration, msg.options);
      startedWall = performance.now();
      workerSelf.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'reset') {
      pipeline = null;
      return;
    }
    if (msg.type === 'frame') {
      if (!pipeline) throw new Error('分析器尚未启动');
      const rgba = new Uint8ClampedArray(msg.buffer);
      const detection: FrameDetection = pipeline.process(rgba, msg.width, msg.height, msg.timeSec);
      workerSelf.postMessage({ type: 'detection', detection });
      return;
    }
    if (msg.type === 'finish') {
      if (!pipeline) throw new Error('分析器尚未启动');
      const elapsed = msg.elapsedMs ?? performance.now() - startedWall;
      const summary = pipeline.finish(msg.processedFrames, msg.skippedFrames, elapsed);
      workerSelf.postMessage({ type: 'summary', summary });
      pipeline = null;
    }
  } catch (err) {
    workerSelf.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

export {};
