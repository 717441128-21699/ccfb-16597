import { SurfPipeline } from '../src/lib/tracker';
import { buildTruth, renderFrameRgb, scenarios, SAMPLE_HEIGHT, SAMPLE_WIDTH } from './sample-model';

function rgbToRgba(rgb: Buffer): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray((rgb.length / 3) * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];
    rgba[j + 1] = rgb[i + 1];
    rgba[j + 2] = rgb[i + 2];
    rgba[j + 3] = 255;
  }
  return rgba;
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const list = only ? scenarios.filter((s) => s.id.includes(only)) : scenarios;
  let failures = 0;

  for (const scenario of list) {
    const truth = buildTruth(scenario);
    const pipeline = new SurfPipeline(truth.calibration, {
      cameraId: 'validate',
      cameraName: scenario.name,
      sourceName: scenario.file,
      videoDurationSec: scenario.durationSec,
      weather: scenario.weather,
    });
    const started = performance.now();
    const step = 4; // 3 Hz analysis sampling.
    let processed = 0;
    for (let frame = 0; frame < scenario.durationSec * 12; frame += step) {
      const rgb = renderFrameRgb(scenario, frame / 12, frame);
      pipeline.process(rgbToRgba(rgb), SAMPLE_WIDTH, SAMPLE_HEIGHT, frame / 12);
      processed++;
    }
    const result = pipeline.finish(processed, 0, performance.now() - started);
    const periodErr = result.periodS === null ? Number.POSITIVE_INFINITY : Math.abs(result.periodS - truth.meanPeriodS);
    const heightRel = result.heightM === null ? Number.POSITIVE_INFINITY : Math.abs(result.heightM - truth.meanHeightM) / truth.meanHeightM;
    const depthRel = result.depthM === null ? Number.POSITIVE_INFINITY : Math.abs(result.depthM - truth.meanDepthM) / truth.meanDepthM;
    const dirOk = result.direction === truth.direction;
    const ok = periodErr <= 0.5 && heightRel <= 0.2 && depthRel <= 0.25 && dirOk;
    if (!ok) failures++;

    console.log('\n===', scenario.id, scenario.weather, ok ? 'PASS' : 'FAIL', '===');
    console.log(
      `period got=${result.periodS} truth=${truth.meanPeriodS} err=${periodErr.toFixed(2)}s | ` +
        `height got=${result.heightM} truth=${truth.meanHeightM} rel=${(heightRel * 100).toFixed(1)}% | ` +
        `depth got=${result.depthM} truth=${truth.meanDepthM} rel=${(depthRel * 100).toFixed(1)}% | ` +
        `dir=${result.direction}/${truth.direction}`,
    );
    console.log(`waves=${result.waves.length} elapsed=${result.elapsedMs}ms confidence=${result.confidence} flags=${result.qualityFlags.length}`);
    for (const w of result.waves) {
      console.log(
        `#${w.index} t=${w.crossingSec.toFixed(2)} P=${w.periodS?.toFixed(2) ?? '-'} H=${w.heightM.toFixed(2)} ` +
          `v=${w.speedMs.toFixed(2)} d=${w.depthM.toFixed(2)} dir=${w.direction} n=${w.samples} c=${w.confidence}`,
      );
    }
  }

  if (failures) {
    console.error(`\n${failures} scenario(s) outside tolerance`);
    process.exit(1);
  }
  console.log('\nAll validated scenarios within tolerance.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
