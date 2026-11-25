import type { AnalysisSummary, SampleTruth, TruthFile } from '../types';
import { loadCameras, loadSettings, saveResult, saveSettings } from '../lib/storage';
import { h, toast } from '../lib/ui';
import { AnalysisRunner, PROCESS_HEIGHT, PROCESS_WIDTH } from '../lib/analysisRunner';
import { drawAnalysisOverlay } from '../components/overlay';
import { confidenceLabel } from '../lib/geometry';
import { directionLabels, levelLabels, weatherLabels } from '../data/defaults';

export function renderAnalysisPage(root: HTMLElement): () => void {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const cameras = loadCameras();
  const initial = cameras.find((c) => c.id === params.get('id')) ?? cameras[0];
  if (!initial) {
    root.append(h('div', { class: 'panel empty' }, '暂无机位，请先到摄像头管理页添加。'));
    return () => {};
  }

  let camera = structuredClone(initial);
  let settings = loadSettings();
  let truthFile: TruthFile | null = null;
  let truth: SampleTruth | undefined;
  let selectedFile: File | null = null;
  let running = false;
  const runner = new AnalysisRunner();

  const cameraSelect = h(
    'select',
    {
      onChange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        window.location.hash = `#/analysis?id=${encodeURIComponent(id)}`;
      },
    },
    ...cameras.map((c) => h('option', { value: c.id, selected: c.id === camera.id }, c.name)),
  ) as HTMLSelectElement;

  const fpsInput = h('input', { type: 'number', min: '2', max: '8', step: '1', value: String(settings.analysisFps) }) as HTMLInputElement;
  const rateInput = h('input', { type: 'number', min: '4', max: '16', step: '1', value: String(settings.fastPlaybackRate) }) as HTMLInputElement;
  const fileLabel = h('span', { class: 'muted small' }, '未选择本地文件；使用机位视频');
  const fileInput = h('input', {
    type: 'file',
    accept: 'video/*',
    onChange: () => {
      selectedFile = fileInput.files?.[0] ?? null;
      fileLabel.textContent = selectedFile ? `已选择：${selectedFile.name}` : '未选择本地文件；使用机位视频';
    },
  }) as HTMLInputElement;

  const video = h('video', { muted: true, playsInline: true, preload: 'metadata', src: camera.src }) as HTMLVideoElement;
  const overlay = h('canvas', { class: 'overlay', width: String(PROCESS_WIDTH), height: String(PROCESS_HEIGHT) }) as HTMLCanvasElement;
  const stage = h('div', { class: 'stage' }, video, overlay);
  const progressBar = h('i', { style: 'width:0%' });
  const progress = h('div', { class: 'progress mt-2' }, progressBar);
  const progressText = h('div', { class: 'muted small mt-2' }, '等待开始');
  const logBox = h('div', { class: 'log', 'aria-live': 'polite' });
  const resultSlot = h('div', { class: 'grid mt-4' });
  const truthSlot = h('div', { class: 'panel mt-4' }, h('p', { class: 'muted' }, '正在读取样例真值…'));

  const startBtn = h('button', { class: 'btn primary', onClick: () => void start() }, '▶ 一分钟快算');
  const stopBtn = h('button', { class: 'btn danger', disabled: true, onClick: () => stop() }, '停止');

  const page = h(
    'section',
    {},
    h('div', { class: 'topbar' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Computer vision'), h('h1', { class: 'page-title' }, '浪况分析'), h('p', { class: 'page-desc' }, 'Worker 中检测并跟踪白沫浪峰线，用礁石经过时间求周期，浅水波速 c=√(gH) 反推水深，并由破碎前浪壁射线换算波高。')),
      h('div', { class: 'top-actions' }, cameraSelect, startBtn, stopBtn),
    ),
    h('div', { class: 'grid split' },
      h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, '实时浪峰跟踪'), h('span', { class: 'badge accent' }, 'Canvas 叠加 / Worker 计算')),
        stage,
        progress,
        progressText,
        h('div', { class: 'panel-head mt-4' }, h('h3', { class: 'panel-title' }, '处理日志')),
        logBox,
      ),
      h('div', { class: 'grid' },
        h('div', { class: 'panel' },
          h('h3', { class: 'panel-title mb-3' }, '分析输入'),
          h('div', { class: 'field' }, h('label', {}, '本地视频（可选）'), fileInput, fileLabel),
          h('div', { class: 'form-grid mt-3' },
            h('div', { class: 'field' }, h('label', {}, '采样帧率 Hz'), fpsInput),
            h('div', { class: 'field' }, h('label', {}, '快速播放倍速'), rateInput),
          ),
          h('div', { class: 'help mt-2' }, '10 分钟录像建议 3Hz 采样、16× 静音快放；检测与视频解码并行，目标墙钟低于 60 秒。'),
        ),
        h('div', { class: 'panel' },
          h('h3', { class: 'panel-title mb-3' }, '机位与可信度'),
          h('div', { class: 'kv' },
            h('dt', {}, '天气模式'), h('dd', {}, weatherLabels[camera.weather]),
            h('dt', {}, '标定高度'), h('dd', {}, `${camera.calibration.cameraHeightM.toFixed(1)} m`),
            h('dt', {}, '俯角/FOV'), h('dd', {}, `${camera.calibration.tiltDeg}° / ${camera.calibration.horizontalFovDeg}°`),
            h('dt', {}, '礁石'), h('dd', {}, `${camera.calibration.reef.x.toFixed(2)}, ${camera.calibration.reef.y.toFixed(2)}`),
          ),
        ),
      ),
    ),
    truthSlot,
    resultSlot,
  );
  root.append(page);
  void loadTruth();

  function log(message: string, level: 'ok' | 'warn' | 'bad' = 'ok'): void {
    const line = h('div', {}, h('span', { class: level }, `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] `), message);
    logBox.append(line);
    logBox.scrollTop = logBox.scrollHeight;
  }

  async function loadTruth(): Promise<void> {
    try {
      const res = await fetch('/samples/truth.json');
      if (!res.ok) throw new Error('truth missing');
      truthFile = (await res.json()) as TruthFile;
      truth = truthFile.samples.find((s) => s.id === camera.sampleId);
      renderTruthPlaceholder();
    } catch {
      truthSlot.replaceChildren(h('h3', { class: 'panel-title' }, '浮标 / 海图对标'), h('p', { class: 'muted' }, '未找到 /samples/truth.json。运行 npm run generate:samples 后可查看自动精度对标。'));
    }
  }

  function renderTruthPlaceholder(): void {
    if (!truth) {
      truthSlot.replaceChildren(h('h3', { class: 'panel-title' }, '浮标 / 海图对标'), h('p', { class: 'muted' }, '当前机位没有合成样例真值；上传真实录像后可对照现场浮标与测深图。'));
      return;
    }
    truthSlot.replaceChildren(
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, '同步真值与验收容差'), h('span', { class: 'badge ok' }, truth.buoy.station)),
      h('div', { class: 'validation-grid' },
        referenceItem('浮标周期', `${truth.buoy.periodS.toFixed(1)} s`, '允许偏差 ≤0.5 s'),
        referenceItem('浮标有效波高', `${truth.buoy.significantHeightM.toFixed(2)} m`, '允许偏差 ≤20%'),
        referenceItem('海图水深', `${truth.chart.reefDepthM.toFixed(1)} m`, `格网容差 ±${truth.chart.toleranceM} m / 25%`),
      ),
      h('p', { class: 'muted small mt-3' }, `真值包含 ${truth.waves.length} 道浪；方向 ${directionLabels[truth.direction]}。运行分析后这里会给出逐项通过状态。`),
    );
  }

  async function start(): Promise<void> {
    if (running) return;
    settings.analysisFps = Math.max(2, Math.min(8, Number(fpsInput.value) || 3));
    settings.fastPlaybackRate = Math.max(4, Math.min(16, Number(rateInput.value) || 16));
    saveSettings(settings);
    const runSettings = { analysisFps: settings.analysisFps, playbackRate: settings.fastPlaybackRate };
    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    resultSlot.replaceChildren();
    logBox.replaceChildren();
    progressBar.style.width = '0%';
    progressText.textContent = '正在加载视频…';
    drawAnalysisOverlay(overlay, null, PROCESS_WIDTH, PROCESS_HEIGHT, camera.calibration);

    try {
      const summary = await runner.run(video, camera, selectedFile, runSettings, {
        onDetection: (d) => drawAnalysisOverlay(overlay, d, PROCESS_WIDTH, PROCESS_HEIGHT, camera.calibration),
        onProgress: (ratio, t) => {
          progressBar.style.width = `${Math.round(ratio * 100)}%`;
          progressText.textContent = `分析位置 ${t.toFixed(1)}s / ${Number.isFinite(video.duration) ? video.duration.toFixed(0) : '?'}s`;
        },
        onLog: log,
      });
      saveResult(summary);
      progressBar.style.width = '100%';
      progressText.textContent = `完成：${summary.videoDurationSec.toFixed(0)}s 视频用时 ${(summary.elapsedMs / 1000).toFixed(1)}s`;
      log(`结果已保存到每日播报；实时倍率 ${summary.realtimeFactor}×`, 'ok');
      renderResult(summary);
      renderValidation(summary);
      toast('浪况分析完成', 'ok');
    } catch (err) {
      if ((err as Error).name === 'AbortError') log('已停止', 'warn');
      else {
        console.error(err);
        log((err as Error).message, 'bad');
        toast('分析失败：' + (err as Error).message, 'bad');
      }
    } finally {
      running = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  function stop(): void {
    runner.cancel();
    video.pause();
    running = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    progressText.textContent = '已停止';
    log('用户停止分析', 'warn');
  }

  function renderValidation(s: AnalysisSummary): void {
    if (!truth) return;
    const periodErr = s.periodS === null ? Infinity : Math.abs(s.periodS - truth.buoy.periodS);
    const heightRel = s.heightM === null ? Infinity : Math.abs(s.heightM - truth.buoy.significantHeightM) / truth.buoy.significantHeightM;
    const depthRel = s.depthM === null ? Infinity : Math.abs(s.depthM - truth.chart.reefDepthM) / truth.chart.reefDepthM;
    const dirOk = s.direction === truth.direction;
    const speedOk = s.videoDurationSec < 590 || s.elapsedMs <= 60000;
    const lowConfidenceMarked = camera.weather === 'clear' || s.confidence < 0.72 || s.qualityFlags.length > 0;

    const items = [
      check('周期对标浮标', periodErr <= 0.5, `视觉 ${s.periodS?.toFixed(2) ?? '—'}s / 浮标 ${truth.buoy.periodS.toFixed(1)}s`, `偏差 ${Number.isFinite(periodErr) ? periodErr.toFixed(2) : '—'}s ≤ 0.5s`),
      check('波高对标浮标', heightRel <= 0.2, `视觉 ${s.heightM?.toFixed(2) ?? '—'}m / 浮标 ${truth.buoy.significantHeightM.toFixed(2)}m`, `相对偏差 ${Number.isFinite(heightRel) ? `${(heightRel * 100).toFixed(1)}%` : '—'} ≤ 20%`),
      check('水深反演对海图', depthRel <= 0.25, `反演 ${s.depthM?.toFixed(2) ?? '—'}m / 海图 ${truth.chart.reefDepthM.toFixed(1)}m`, `相对偏差 ${Number.isFinite(depthRel) ? `${(depthRel * 100).toFixed(1)}%` : '—'} ≤ 25%`),
      check('卷浪方向', dirOk, directionLabels[s.direction], `真值：${directionLabels[truth.direction]}`),
      check('十分钟性能', speedOk, `${(s.elapsedMs / 1000).toFixed(1)}s`, `600s 录像目标 ≤60s；当前倍率 ${s.realtimeFactor}×`),
      check('恶劣光照可信度', lowConfidenceMarked, confidenceLabel(s.confidence).text, s.qualityFlags[0] ?? '无额外眩光/降雨标记'),
    ];
    truthSlot.replaceChildren(
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, '浮标 / 海图同步对标结果'), h('span', { class: 'badge ok' }, `${items.filter((i) => i.dataset.pass === 'true').length}/${items.length} 项通过`)),
      h('div', { class: 'validation-grid' }, ...items),
    );
  }

  function renderResult(s: AnalysisSummary): void {
    const conf = confidenceLabel(s.confidence);
    resultSlot.replaceChildren(
      h('div', { class: 'grid cols-4' },
        metric('浪周期', s.periodS?.toFixed(1) ?? '—', 's', `浮标口径连续浪间隔；共 ${s.waves.length} 道`, s.periodS && Math.abs(s.periodS - (truth?.meanPeriodS ?? s.periodS)) < 0.5 ? 'good' : 'accent'),
        metric('波高', s.heightM?.toFixed(2) ?? '—', 'm', '破碎前浪壁射线换算', 'accent'),
        metric('反推水深', s.depthM?.toFixed(2) ?? '—', 'm', `传播速度 ${s.speedMs?.toFixed(2) ?? '—'} m/s`, 'accent'),
        metric('综合可信度', `${Math.round(s.confidence * 100)}`, '%', conf.text, s.confidence >= 0.75 ? 'good' : s.confidence >= 0.55 ? 'warn' : 'bad'),
      ),
      h('div', { class: 'grid split' },
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', { class: 'panel-title' }, '逐道浪测量')),
          h('div', { class: 'table-wrap' }, waveTable(s)),
        ),
        h('div', { class: 'grid' },
          h('div', { class: `panel ${s.surf.rideable ? '' : ''}` },
            h('div', { class: 'panel-head' }, h('h3', { class: 'panel-title' }, '能不能冲？'), h('span', { class: `badge ${s.surf.level === 'good' ? 'ok' : s.surf.level === 'unsafe' ? 'bad' : 'warn'}` }, levelLabels[s.surf.level])),
            h('div', { class: 'metric-value good' }, `${s.surf.score}`, h('span', { class: 'metric-unit' }, '冲浪指数')),
            h('p', { class: 'muted mt-3' }, s.surf.rideable ? '系统判断：有可播报的可冲浪况。' : '系统判断：建议谨慎或不要组织下水。'),
            h('ul', { class: 'muted', style: 'line-height:1.8;padding-left:18px' }, ...s.surf.reasons.map((r) => h('li', {}, r))),
            h('div', { class: 'pill-row mt-3' }, h('span', { class: 'badge accent' }, directionLabels[s.direction]), h('span', { class: `badge ${s.confidence < 0.6 ? 'warn' : 'ok'}` }, conf.text)),
          ),
          h('div', { class: 'panel' },
            h('h3', { class: 'panel-title mb-3' }, '播报与记录'),
            h('div', { class: 'flex wrap' },
              h('a', { class: 'btn primary', href: '#/report?result=latest' }, '生成今日播报'),
              h('button', { class: 'btn', onClick: () => downloadSummary(s) }, '导出分析 JSON'),
            ),
            h('p', { class: 'help mt-3' }, `处理 ${s.processedFrames} 帧 / 跳过 ${s.skippedFrames} 帧；平均检测 ${s.averageFps} fps。`),
          ),
        ),
      ),
    );
  }

  return () => {
    runner.cancel();
    video.pause();
  };
}

function metric(label: string, value: string, unit: string, foot: string, cls = ''): HTMLElement {
  return h('div', { class: 'panel metric' },
    h('div', { class: 'metric-label' }, label),
    h('div', { class: `metric-value ${cls}` }, value, h('span', { class: 'metric-unit' }, unit)),
    h('div', { class: 'metric-foot' }, foot),
  );
}

function referenceItem(label: string, value: string, foot: string): HTMLElement {
  return h('div', { class: 'validation-item' }, h('div', { class: 'v-label' }, label), h('div', { class: 'v-value text-accent' }, value), h('div', { class: 'help' }, foot));
}

function check(label: string, pass: boolean, actual: string, tolerance: string): HTMLElement {
  const el = h('div', { class: `validation-item ${pass ? '' : 'bad'}` },
    h('div', { class: 'flex between' }, h('div', { class: 'v-label' }, label), h('span', { class: `badge ${pass ? 'ok' : 'bad'}` }, pass ? '通过' : '未达容差')),
    h('div', { class: 'v-value', style: 'font-size:17px' }, actual),
    h('div', { class: 'help' }, tolerance),
  );
  el.dataset.pass = String(pass);
  return el;
}

function waveTable(s: AnalysisSummary): HTMLElement {
  const head = h('thead', {}, h('tr', {},
    h('th', {}, '#'), h('th', {}, '经过时间'), h('th', { class: 'num' }, '周期 s'), h('th', { class: 'num' }, '波高 m'),
    h('th', { class: 'num' }, '波速 m/s'), h('th', { class: 'num' }, '水深 m'), h('th', {}, '方向'), h('th', { class: 'num' }, '可信度'),
  ));
  const body = h('tbody', {});
  for (const w of s.waves) {
    body.append(h('tr', {},
      h('td', {}, String(w.index)),
      h('td', {}, w.clockTime ?? `${w.crossingSec.toFixed(2)}s`),
      h('td', { class: 'num' }, w.periodS?.toFixed(2) ?? '—'),
      h('td', { class: 'num' }, w.heightM ? w.heightM.toFixed(2) : '—'),
      h('td', { class: 'num' }, w.speedMs ? w.speedMs.toFixed(2) : '—'),
      h('td', { class: 'num' }, w.depthM ? w.depthM.toFixed(2) : '—'),
      h('td', {}, directionLabels[w.direction]),
      h('td', { class: 'num' }, `${Math.round(w.confidence * 100)}%`),
    ));
  }
  return h('table', {}, head, body);
}

function downloadSummary(s: AnalysisSummary): void {
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `surfcam-${s.cameraId}-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
