import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import {
  buildTruth,
  renderFrameRgb,
  scenarios,
  SAMPLE_FPS,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  type SampleScenario,
} from './sample-model';
import type { TruthFile } from '../src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'public', 'samples');
const force = process.argv.includes('--force');

function ffmpeg(args: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveExit(0);
      else reject(new Error(`ffmpeg exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function encodeScenario(scenario: SampleScenario): Promise<void> {
  const out = resolve(outDir, scenario.file);
  if (!force && (await exists(out))) {
    console.log(`skip existing ${scenario.file} (use --force to overwrite)`);
    return;
  }
  console.log(`generating ${scenario.file} (${scenario.durationSec}s)...`);
  const child = spawn(
    'ffmpeg',
    [
      '-y',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgb24',
      '-video_size',
      `${SAMPLE_WIDTH}x${SAMPLE_HEIGHT}`,
      '-framerate',
      String(SAMPLE_FPS),
      '-i',
      '-',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '22',
      '-preset',
      'veryfast',
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  child.on('error', (err) => {
    throw err;
  });

  const total = Math.round(scenario.durationSec * SAMPLE_FPS);
  for (let frame = 0; frame < total; frame++) {
    const t = frame / SAMPLE_FPS;
    const buf = renderFrameRgb(scenario, t, frame);
    if (!child.stdin.write(buf)) await once(child.stdin, 'drain');
    if (frame % 120 === 0) process.stdout.write(`  ${scenario.id} ${Math.round((frame / total) * 100)}%\r`);
  }
  child.stdin.end();
  await once(child, 'close');
  console.log(`  ${scenario.file} done.             `);
}

async function makeBenchmark(): Promise<void> {
  const loopScenario: SampleScenario = {
    ...scenarios[0],
    id: 'benchmark-loop',
    name: '十分钟性能基准循环',
    durationSec: 50,
    periodS: 10,
    heightM: 1.45,
    depthM: 3.2,
    direction: 'ltr',
    weather: 'clear',
    seed: 505,
    file: 'benchmark-loop.mp4',
  };
  const loopPath = resolve(outDir, loopScenario.file);
  const benchmarkPath = resolve(outDir, 'benchmark-10m.mp4');
  if (force || !(await exists(loopPath))) await encodeScenario(loopScenario);
  if (force || !(await exists(benchmarkPath))) {
    console.log('looping benchmark to 600 seconds...');
    await ffmpeg([
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      loopPath,
      '-t',
      '600',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '23',
      '-preset',
      'veryfast',
      '-movflags',
      '+faststart',
      benchmarkPath,
    ]);
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const scenario of scenarios) await encodeScenario(scenario);
  await makeBenchmark();

  const sampleTruth = scenarios.map(buildTruth);
  const benchmarkScenario: SampleScenario = {
    ...scenarios[0],
    id: 'benchmark-10m',
    name: '十分钟性能基准',
    file: 'benchmark-10m.mp4',
    durationSec: 600,
    periodS: 10,
    heightM: 1.45,
    depthM: 3.2,
    direction: 'ltr',
    weather: 'clear',
    seed: 505,
  };
  sampleTruth.push(buildTruth(benchmarkScenario));

  const truth: TruthFile = {
    version: 1,
    generatedAt: '2026-11-26T06:00:00+08:00',
    samples: sampleTruth,
  };
  await writeFile(resolve(outDir, 'truth.json'), JSON.stringify(truth, null, 2), 'utf8');

  const cameras = {
    version: 1,
    cameras: sampleTruth
      .filter((s) => s.id !== 'benchmark-10m')
      .map((s, i) => ({
        id: `cam-${s.id}`,
        name: ['一号塔台', '南礁机位', '北滩东桩', '西门栈道'][i] ?? `机位 ${i + 1}`,
        beach: s.name,
        sourceKind: 'sample',
        src: `/samples/${s.file}`,
        sampleId: s.id,
        enabled: true,
        weather: s.weather,
        calibration: s.calibration,
        notes: s.id === 'clean-ltr' ? '日常练习主力机位' : '',
        createdAt: '2026-11-25T20:00:00+08:00',
      }))
      .concat({
        id: 'cam-benchmark',
        name: '性能基准机位',
        beach: '十分钟循环涌浪',
        sourceKind: 'sample',
        src: '/samples/benchmark-10m.mp4',
        sampleId: 'benchmark-10m',
        enabled: true,
        weather: 'clear',
        calibration: benchmarkScenario && sampleTruth[sampleTruth.length - 1].calibration,
        notes: '600 秒录像，用于验证一分钟内出结果',
        createdAt: '2026-11-25T20:00:00+08:00',
      }),
  };
  await writeFile(resolve(outDir, 'cameras.seed.json'), JSON.stringify(cameras, null, 2), 'utf8');
  console.log(`truth and camera seed written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
