import type { CameraInfo, WeatherCondition } from '../types';
import { deleteCamera, fallbackCameras, loadCameras, uid, upsertCamera } from '../lib/storage';
import { h, modal, toast } from '../lib/ui';
import { weatherLabels } from '../data/defaults';

export function renderCamerasPage(root: HTMLElement): () => void {
  let cameras = loadCameras();

  const header = h(
    'div',
    { class: 'topbar' },
    h(
      'div',
      {},
      h('div', { class: 'eyebrow' }, 'Camera fleet'),
      h('h1', { class: 'page-title' }, '摄像头管理'),
      h('p', { class: 'page-desc' }, '维护海滩机位、视频源和天气模式。内置样例由涌浪模型渲染，并附带每道浪的周期、波高、速度、水深与卷浪方向真值。'),
    ),
    h(
      'div',
      { class: 'top-actions' },
      h('button', { class: 'btn', onClick: () => resetSamples() }, '恢复内置机位'),
      h('button', { class: 'btn primary', onClick: () => openEditor() }, '＋ 添加摄像头'),
    ),
  );

  const grid = h('div', { class: 'camera-grid' });
  const page = h('section', {}, header, grid);
  root.append(page);
  drawCards();

  function drawCards(): void {
    grid.replaceChildren();
    if (!cameras.length) {
      grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, h('div', { class: 'big' }, '📷'), '还没有摄像头，点击右上角添加。'));
      return;
    }
    for (const cam of cameras) grid.append(cameraCard(cam));
  }

  function cameraCard(cam: CameraInfo): HTMLElement {
    const sampleOptions = fallbackCameras.find((c) => c.sampleId === cam.sampleId);
    const video = h('video', {
      muted: true,
      playsInline: true,
      preload: 'metadata',
      src: `${cam.src}#t=4`,
      onerror: () => {
        video.replaceWith(h('div', { class: 'stage-placeholder' }, '样例视频尚未生成\n运行 npm run generate:samples'));
      },
    } as Partial<HTMLVideoElement>);
    const weatherBadge = h('span', { class: `badge ${cam.weather === 'clear' ? 'ok' : 'warn'}` }, weatherLabels[cam.weather]);
    const enabledBadge = h('span', { class: `badge ${cam.enabled ? 'ok' : ''}` }, cam.enabled ? '● 启用中' : '已停用');
    return h(
      'article',
      { class: 'panel camera-card' },
      h('div', { class: 'thumb' }, video, h('div', { class: 'live' }, enabledBadge), h('div', { class: 'weather' }, weatherBadge)),
      h(
        'div',
        { class: 'camera-body' },
        h('div', { class: 'camera-name' }, cam.name),
        h('div', { class: 'camera-meta' }, h('div', {}, `📍 ${cam.beach}`), h('div', {}, `🎥 ${cam.sourceKind === 'sample' ? '内置样例' : '视频/流地址'}：${sampleOptions?.sampleId ?? cam.src}`)),
        h(
          'div',
          { class: 'card-actions' },
          h('a', { class: 'btn primary small', href: `#/analysis?id=${encodeURIComponent(cam.id)}` }, '分析浪况'),
          h('a', { class: 'btn small', href: `#/calibration?id=${encodeURIComponent(cam.id)}` }, '标定'),
          h('button', { class: 'btn small', onClick: () => openEditor(cam) }, '编辑'),
          h('button', {
            class: 'btn danger small',
            onClick: () => {
              if (confirm(`删除机位「${cam.name}」？`)) {
                cameras = deleteCamera(cam.id);
                drawCards();
                toast('机位已删除', 'ok');
              }
            },
          }, '删除'),
        ),
      ),
    );
  }

  function openEditor(existing?: CameraInfo): void {
    const draft: CameraInfo = existing
      ? structuredClone(existing)
      : {
          id: uid('cam'),
          name: '',
          beach: '',
          sourceKind: 'sample',
          src: fallbackCameras[0].src,
          sampleId: fallbackCameras[0].sampleId,
          enabled: true,
          weather: 'clear',
          calibration: structuredClone(fallbackCameras[0].calibration),
          createdAt: new Date().toISOString(),
        };

    const nameInput = h('input', { value: draft.name, placeholder: '例如：一号塔台' }) as HTMLInputElement;
    const beachInput = h('input', { value: draft.beach, placeholder: '例如：清水点 / 南礁' }) as HTMLInputElement;
    const kindSelect = h(
      'select',
      {},
      h('option', { value: 'sample', selected: draft.sourceKind === 'sample' }, '内置样例视频'),
      h('option', { value: 'stream', selected: draft.sourceKind !== 'sample' }, 'HTTP 视频 / 摄像头地址'),
    ) as HTMLSelectElement;
    const sampleSelect = h(
      'select',
      {},
      ...fallbackCameras.map((c) => h('option', { value: c.id, selected: draft.sampleId === c.sampleId }, `${c.beach}（${c.sampleId}）`)),
    ) as HTMLSelectElement;
    const urlInput = h('input', { value: draft.src, placeholder: 'https://…/beach.mp4 或 /stream.m3u8' }) as HTMLInputElement;
    const weatherSelect = h(
      'select',
      {},
      ...Object.entries(weatherLabels).map(([value, label]) => h('option', { value, selected: draft.weather === value }, label)),
    ) as HTMLSelectElement;
    const enabledInput = h('input', { type: 'checkbox', checked: draft.enabled }) as HTMLInputElement;
    const notesInput = h('textarea', { placeholder: '机位备注、朝向、常见遮挡等' }, draft.notes ?? '') as HTMLTextAreaElement;
    const sourceField = h('div', { class: 'field' }, h('label', {}, '视频地址'), urlInput, h('div', { class: 'help' }, '浏览器可直接解码 MP4/WebM；HLS 需站点提供 hls.js 或原生 Safari 支持。'));

    function syncKind(): void {
      const isSample = kindSelect.value === 'sample';
      sampleSelect.hidden = !isSample;
      urlInput.hidden = isSample;
      sourceField.style.display = isSample ? 'none' : '';
    }
    kindSelect.addEventListener('change', syncKind);
    syncKind();

    let close: () => void = () => {};
    const content = h(
      'div',
      {},
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, existing ? '编辑摄像头' : '添加摄像头')),
      h(
        'div',
        { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', {}, '机位名称 *'), nameInput),
        h('div', { class: 'field' }, h('label', {}, '海滩/浪点 *'), beachInput),
        h('div', { class: 'field' }, h('label', {}, '视频来源类型'), kindSelect),
        h('div', { class: 'field' }, h('label', {}, '选择样例涌浪'), sampleSelect),
        sourceField,
        h('div', { class: 'field' }, h('label', {}, '常见天气/光照'), weatherSelect),
        h('div', { class: 'field' }, h('label', {}, '启用状态'), h('label', { class: 'check-row' }, enabledInput, '在机位列表中启用')),
        h('div', { class: 'field full' }, h('label', {}, '备注'), notesInput),
      ),
      h(
        'div',
        { class: 'flex mt-4' },
        h('button', { class: 'btn primary', onClick: save }, '保存机位'),
        h('button', { class: 'btn', onClick: () => close() }, '取消'),
      ),
    );
    close = modal(content);

    function save(): void {
      if (!nameInput.value.trim() || !beachInput.value.trim()) {
        toast('请填写机位名称和浪点', 'bad');
        return;
      }
      draft.name = nameInput.value.trim();
      draft.beach = beachInput.value.trim();
      draft.weather = weatherSelect.value as WeatherCondition;
      draft.enabled = enabledInput.checked;
      draft.notes = notesInput.value.trim();
      draft.sourceKind = kindSelect.value as CameraInfo['sourceKind'];
      if (draft.sourceKind === 'sample') {
        const selected = fallbackCameras.find((c) => c.id === sampleSelect.value) ?? fallbackCameras[0];
        draft.sampleId = selected.sampleId;
        draft.src = selected.src;
        draft.calibration = structuredClone(selected.calibration);
        if (weatherSelect.value === 'clear') draft.weather = selected.weather;
      } else {
        draft.src = urlInput.value.trim();
        if (!draft.src) {
          toast('请填写视频地址', 'bad');
          return;
        }
      }
      cameras = upsertCamera(draft);
      close();
      drawCards();
      toast('摄像头已保存', 'ok');
    }
  }

  function resetSamples(): void {
    localStorage.removeItem('surfcam.cameras.v1');
    cameras = loadCameras();
    drawCards();
    toast('已恢复内置机位与标定', 'ok');
  }

  return () => {};
}
