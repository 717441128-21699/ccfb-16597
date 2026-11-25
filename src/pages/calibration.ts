import type { CameraInfo, Calibration } from '../types';
import { loadCameras, upsertCamera } from '../lib/storage';
import { h, toast } from '../lib/ui';
import { depthToSpeedMs, horizonY, rowToDistanceM } from '../lib/geometry';
import { weatherLabels } from '../data/defaults';

export function renderCalibrationPage(root: HTMLElement): () => void {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const cameras = loadCameras().filter((c) => c.enabled);
  const initial = cameras.find((c) => c.id === params.get('id')) ?? cameras[0];
  if (!initial) {
    root.append(h('section', { class: 'panel empty' }, '请先在摄像头管理页添加机位。'));
    return () => {};
  }

  let camera: CameraInfo = structuredClone(initial);
  const cal: Calibration = camera.calibration;

  const select = h(
    'select',
    {
      onChange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        window.location.hash = `#/calibration?id=${encodeURIComponent(id)}`;
      },
    },
    ...cameras.map((c) => h('option', { value: c.id, selected: c.id === camera.id }, c.name)),
  ) as HTMLSelectElement;

  const video = h('video', {
    src: `${camera.src}#t=5`,
    muted: true,
    controls: true,
    playsInline: true,
    preload: 'metadata',
  }) as HTMLVideoElement;
  const canvas = h('canvas', { class: 'overlay calibration', width: '640', height: '360' }) as HTMLCanvasElement;
  const stage = h('div', { class: 'stage' }, video, canvas);

  const heightInput = numberField('摄像头离海面高度 H (m)', cal.cameraHeightM, 0.5, 30, 0.1, (v) => (cal.cameraHeightM = v));
  const tiltInput = numberField('俯角 θ (°)', cal.tiltDeg, -10, 45, 0.1, (v) => (cal.tiltDeg = v));
  const fovInput = numberField('水平视场角 (°)', cal.horizontalFovDeg, 25, 120, 0.5, (v) => (cal.horizontalFovDeg = v));
  const depthInput = numberField('海图礁石水深 (m)', cal.reefDepthM, 0.5, 20, 0.1, (v) => (cal.reefDepthM = v));
  const markerMInput = numberField('已知标志物长度 (m，可选)', cal.knownMarkerLengthM ?? 0, 0, 100, 0.1, (v) => (cal.knownMarkerLengthM = v || undefined));
  const markerPxInput = numberField('标志物像素长度 (px，可选)', cal.knownMarkerLengthPx ?? 0, 0, 2000, 1, (v) => (cal.knownMarkerLengthPx = v || undefined));

  const readout = h('div', { class: 'kv' });
  function updateReadout(): void {
    const z = rowToDistanceM(cal.reef.y * 360, 640, 360, cal);
    const c = depthToSpeedMs(cal.reefDepthM);
    readout.replaceChildren(
      h('dt', {}, '礁石位置'), h('dd', {}, `x=${cal.reef.x.toFixed(3)}, y=${cal.reef.y.toFixed(3)}（点击画面修正）`),
      h('dt', {}, '反算距离'), h('dd', { class: Number.isFinite(z) ? 'text-accent strong' : 'text-bad' }, Number.isFinite(z) ? `${z.toFixed(1)} m` : '俯角不足，地平线以上'),
      h('dt', {}, '浅水波速'), h('dd', {}, `c=√(gH)=${c.toFixed(2)} m/s`),
      h('dt', {}, '海图水深'), h('dd', {}, `${cal.reefDepthM.toFixed(1)} m；允许反演偏差 ≤25%`),
      h('dt', {}, '天气模式'), h('dd', {}, weatherLabels[camera.weather] ?? camera.weather),
    );
  }

  function drawCalibration(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 640, 360);
    const hy = horizonY(cal, 360);

    if (Number.isFinite(hy) && hy > 0 && hy < 360) {
      ctx.save();
      ctx.strokeStyle = 'rgba(98,168,255,.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([9, 7]);
      ctx.beginPath();
      ctx.moveTo(0, hy);
      ctx.lineTo(640, hy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#9fcfff';
      ctx.font = '700 13px system-ui';
      ctx.fillText(`地平线 / horizon y=${hy.toFixed(0)}`, 14, Math.max(18, hy - 8));
      ctx.restore();
    }

    ctx.save();
    ctx.font = '700 12px ui-monospace, monospace';
    for (const d of [8, 12, 16, 20, 25, 30, 40, 60]) {
      // Inverse projection is in geometry.distanceToRowM; use row search via imported function dynamically.
      const y = distanceRow(d, cal);
      if (y < hy + 4 || y > 354) continue;
      ctx.strokeStyle = d === 20 ? 'rgba(85,224,210,.5)' : 'rgba(234,247,255,.22)';
      ctx.lineWidth = d === 20 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(640, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(234,247,255,.72)';
      ctx.fillText(`${d}m`, 10, y - 5);
    }
    ctx.restore();

    const rx = cal.reef.x * 640;
    const ry = cal.reef.y * 360;
    ctx.save();
    ctx.strokeStyle = '#ffc857';
    ctx.fillStyle = 'rgba(255,200,87,.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rx, ry, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx - 18, ry); ctx.lineTo(rx + 18, ry);
    ctx.moveTo(rx, ry - 18); ctx.lineTo(rx, ry + 18);
    ctx.stroke();
    ctx.fillStyle = '#ffd98a';
    ctx.font = '850 14px system-ui';
    ctx.fillText('周期基准礁石', rx + 16, ry - 14);
    ctx.restore();
    updateReadout();
  }

  function setReefFromEvent(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    cal.reef.x = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    cal.reef.y = Math.max(0.18, Math.min(0.95, (e.clientY - rect.top) / rect.height));
    drawCalibration();
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    setReefFromEvent(e);
  });
  canvas.addEventListener('pointermove', (e) => dragging && setReefFromEvent(e));
  canvas.addEventListener('pointerup', () => (dragging = false));

  for (const field of [heightInput, tiltInput, fovInput, depthInput, markerMInput, markerPxInput]) {
    field.input.addEventListener('input', () => drawCalibration());
  }

  const saveBtn = h('button', {
    class: 'btn primary',
    onClick: () => {
      camera.calibration = { ...cal, calibratedAt: new Date().toISOString() };
      upsertCamera(camera);
      toast('标定参数已保存到机位', 'ok');
    },
  }, '保存标定');
  const analyzeBtn = h('a', { class: 'btn', href: `#/analysis?id=${encodeURIComponent(camera.id)}` }, '用此标定分析 →');

  const page = h(
    'section',
    {},
    h('div', { class: 'topbar' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Calibration'), h('h1', { class: 'page-title' }, '相机标定'), h('p', { class: 'page-desc' }, '事先量好摄像头离海面高度与俯角；在画面上点击前后白沫共同经过的礁石。几何网格用于核对像素行到海面距离的映射。')),
      h('div', { class: 'top-actions' }, select, saveBtn, analyzeBtn),
    ),
    h('div', { class: 'grid split' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, camera.name), h('span', { class: 'badge accent' }, '点击画面移动礁石标记')), stage),
      h('div', { class: 'grid' },
        h('div', { class: 'panel' }, h('h3', { class: 'panel-title mb-3' }, '几何参数'), h('div', { class: 'form-grid' }, heightInput.field, tiltInput.field, fovInput.field, depthInput.field, markerMInput.field, markerPxInput.field)),
        h('div', { class: 'panel' }, h('h3', { class: 'panel-title mb-3' }, '投影核对'), readout),
      ),
    ),
  );
  root.append(page);
  video.addEventListener('loadedmetadata', drawCalibration);
  setTimeout(drawCalibration, 80);
  return () => video.pause();
}

function numberField(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): { field: HTMLDivElement; input: HTMLInputElement } {
  const input = h('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  const field = h('div', { class: 'field' }, h('label', {}, label), input);
  return { field, input };
}

function distanceRow(distanceM: number, cal: Calibration): number {
  // Local inverse avoids a circular import concern and keeps the calibration canvas explicit.
  const H = cal.imageHeight;
  const W = cal.imageWidth;
  const f = W / (2 * Math.tan((cal.horizontalFovDeg * Math.PI) / 360));
  const theta = Math.atan2(cal.cameraHeightM, distanceM);
  return H / 2 + f * Math.tan(theta - (cal.tiltDeg * Math.PI) / 180);
}
