import type { AnalysisSummary, ConditionPoint } from '../types';
import { loadResults, loadSettings, clearResults } from '../lib/storage';
import { h, toast, downloadText } from '../lib/ui';
import { renderConditionChart } from '../components/charts';
import { aggregateDay, buildDemoDay } from '../data/dailySeed';
import { directionLabels, levelLabels } from '../data/defaults';

export function renderReportPage(root: HTMLElement): () => void {
  const settings = loadSettings();
  const results = loadResults();
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  let points: ConditionPoint[] = buildDemoDay();
  let selectedResult: AnalysisSummary | null = params.get('result') === 'latest' ? results[0] ?? null : null;
  if (selectedResult) points = mergeResultIntoDay(points, selectedResult);
  let destroyChart: (() => void) | null = null;

  const dateInput = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }) as HTMLInputElement;
  const sourceSelect = h(
    'select',
    {
      onChange: () => {
        const value = sourceSelect.value;
        if (value === 'demo') {
          points = buildDemoDay();
        } else {
          selectedResult = results.find((r) => r.id === value) ?? results[0] ?? null;
          points = selectedResult?.curve?.length ? selectedResult.curve : buildDemoDay();
          if (!selectedResult?.curve?.length) toast('该记录没有分桶曲线，已显示示例全天', 'info');
        }
        if (value === 'demo' && selectedResult) points = mergeResultIntoDay(points, selectedResult);
        update();
      },
    },
    h('option', { value: 'demo' }, '示例全天涌浪日（05:30–19:30）'),
    ...results.map((r) => h('option', { value: r.id, selected: false }, `${r.cameraName} · ${new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false })}`)),
  ) as HTMLSelectElement;

  const canvas = h('canvas', { 'aria-label': '全天浪况曲线' }) as HTMLCanvasElement;
  const broadcast = h('div', { class: 'broadcast' });
  const stats = h('div', { class: 'grid cols-4' });

  const copyBtn = h('button', {
    class: 'btn primary',
    onClick: async () => {
      const text = broadcast.innerText;
      try {
        await navigator.clipboard.writeText(text);
        toast('播报文案已复制，可粘贴到会员群', 'ok');
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.append(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('播报文案已复制', 'ok');
      }
    },
  }, '📋 复制播报');
  const speakBtn = h('button', { class: 'btn', onClick: () => speak(broadcast.innerText) }, '🔊 语音预览');
  const downloadBtn = h('button', { class: 'btn', onClick: () => downloadText(`浪况播报-${dateInput.value}.txt`, broadcast.innerText) }, '下载 TXT');
  const clearBtn = h('button', {
    class: 'btn danger small',
    onClick: () => {
      if (confirm('清空本机保存的分析记录？示例曲线不受影响。')) {
        clearResults();
        location.hash = '#/report';
        location.reload();
      }
    },
  }, '清空分析记录');

  const page = h(
    'section',
    {},
    h('div', { class: 'topbar' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Daily broadcast'), h('h1', { class: 'page-title' }, '每日播报'), h('p', { class: 'page-desc' }, '把摄像头测得的周期、波高、卷浪方向、可冲指数和可信度整理成教练可直接发群的中文播报，并按时间回看当天浪况曲线。')),
      h('div', { class: 'top-actions' }, dateInput, copyBtn, speakBtn, downloadBtn),
    ),
    h('div', { class: 'panel mb-3' },
      h('div', { class: 'flex wrap between' },
        h('div', { class: 'flex wrap' }, h('div', { class: 'field', style: 'min-width:260px' }, h('label', {}, '曲线数据源'), sourceSelect), selectedResult ? h('span', { class: 'badge ok' }, '已叠加最新实测') : null, clearBtn),
        h('div', { class: 'chart-legend' },
          h('span', {}, h('i', { class: 'legend-dot', style: 'background:var(--accent)' }), '波高 m'),
          h('span', {}, h('i', { class: 'legend-dot', style: 'background:var(--accent-2)' }), '周期 s'),
          h('span', {}, h('i', { class: 'legend-dot', style: 'background:var(--warn)' }), '低可信点'),
        ),
      ),
      h('div', { class: 'chart-box mt-3' }, canvas),
    ),
    stats,
    h('div', { class: 'grid split mt-4' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, '群播报预览'), h('span', { class: 'badge accent' }, settings.broadcastGroup)), broadcast),
      h('div', { class: 'panel' },
        h('h3', { class: 'panel-title mb-3' }, '播报生成说明'),
        h('ul', { class: 'muted', style: 'line-height:1.9;padding-left:18px' },
          h('li', {}, '周期取连续两道白沫经过同一礁石的时间差中位数。'),
          h('li', {}, '水深由 c=√(gH) 反推，并与海图测深格网比较。'),
          h('li', {}, '波高来自破碎前浪壁上下边缘的射线几何换算。'),
          h('li', {}, '下雨、逆光或低对比时自动降低可信度并提示现场复核。'),
          h('li', {}, '外地会员建议以当日最佳窗口和安全提示为准。'),
        ),
        selectedResult ? h('div', { class: 'mt-3' }, h('a', { class: 'btn small', href: `#/analysis?id=${encodeURIComponent(selectedResult.cameraId)}` }, '查看本次分析详情')) : h('div', { class: 'empty small mt-3' }, '可在分析页完成一次真实计算后，将结果带入播报。'),
      ),
    ),
  );
  root.append(page);

  function update(): void {
    destroyChart?.();
    destroyChart = renderConditionChart(canvas, points);
    const agg = aggregateDay(points);
    stats.replaceChildren(
      stat('最大波高', agg.maxHeight.toFixed(2), 'm', 'good'),
      stat('平均周期', agg.meanPeriod.toFixed(1), 's', 'accent'),
      stat('最佳窗口', agg.best?.time ?? '—', `指数 ${agg.best?.surfScore ?? '—'}`, 'warn'),
      stat('最低可信度', `${Math.round(agg.minConfidence * 100)}`, '%', agg.minConfidence < 0.6 ? 'warn' : 'good'),
    );
    broadcast.replaceChildren(...buildBroadcastNodes(dateInput.value, points, selectedResult, settings.clubName));
  }
  dateInput.addEventListener('change', update);
  update();

  return () => {
    destroyChart?.();
    window.speechSynthesis?.cancel();
  };
}

function stat(label: string, value: string, foot: string, cls: string): HTMLElement {
  return h('div', { class: 'panel metric' }, h('div', { class: 'metric-label' }, label), h('div', { class: `metric-value ${cls}` }, value), h('div', { class: 'metric-foot' }, foot));
}

function buildBroadcastNodes(date: string, points: ConditionPoint[], result: AnalysisSummary | null, clubName: string): Node[] {
  const agg = aggregateDay(points);
  const best = agg.best;
  const low = points.filter((p) => p.confidence < 0.62);
  const direction = result?.direction ?? (best?.hour && best.hour < 14 ? 'ltr' : 'rtl');
  const level = result?.surf.level ?? (best && best.surfScore >= 76 ? 'good' : best && best.surfScore >= 55 ? 'marginal' : 'poor');
  const advice =
    level === 'good'
      ? '浪壁干净、有连续切面，建议初级会员在教练陪同下于最佳窗口下水。'
      : level === 'marginal'
        ? '浪况一般，建议会抓绿浪的会员前往，新手改上理论/划水课。'
        : '可玩窗口短且条件不稳定，不建议外地会员专程前往，出发前请看群内二次确认。';

  const lines = [
    `【${clubName} · ${date} 浪况播报】`,
    `各位早，今天海滩摄像头已完成自动巡测：`,
    `• 浪高：全天约 ${Math.min(...points.map((p) => p.heightM)).toFixed(1)}–${agg.maxHeight.toFixed(1)} m，平均 ${agg.meanHeight.toFixed(1)} m；`,
    `• 周期：平均 ${agg.meanPeriod.toFixed(1)} s，最大 ${agg.maxPeriod.toFixed(1)} s，涌浪能量${agg.meanPeriod >= 9 ? '较足' : '中等'}；`,
    `• 最佳窗口：${best ? `${best.time} 前后，冲浪指数 ${best.surfScore}/100` : '暂无稳定窗口'}；`,
    `• 卷浪方向：${directionLabels[direction]}；`,
    result?.depthM ? `• 礁区反推水深约 ${result.depthM.toFixed(1)} m，波速 ${result.speedMs?.toFixed(1)} m/s；` : `• 浅海反演水深约 ${best?.depthM.toFixed(1) ?? '—'} m，和测深图基本一致；`,
    low.length ? `• 可信度：${low[0].time}–${low[low.length - 1].time} 有雨/逆光/眩光，系统已标为可信度降低，请以教练现场肉眼复核为准；` : '• 天气和光照较好，视觉测浪可信度较高；',
    `• 建议：${advice}`,
    '想来看浪的外地会员请先在群里回复人数，我们会在出发前再发一次实时画面。',
  ];
  if (result?.surf.reasons.length) lines.splice(7, 0, `• 分析依据：${result.surf.reasons.slice(0, 2).join('；')}。`);
  return [
    h('div', { class: 'b-title' }, lines[0]),
    h('div', { class: 'speak' }, ...lines.slice(1).flatMap((line, i) => (i === 0 ? [line] : [document.createElement('br'), line]))),
    h('div', { class: 'muted small mt-3' }, `状态：${levelLabels[level]} · 数据来自岸瞳 SurfCam 摄像头视觉分析`),
  ];
}

function mergeResultIntoDay(day: ConditionPoint[], result: AnalysisSummary): ConditionPoint[] {
  const merged = day.map((p) => ({ ...p }));
  for (const measured of result.curve ?? []) {
    const idx = merged.findIndex((p) => p.time === measured.time);
    if (idx >= 0) merged[idx] = { ...measured };
    else merged.push({ ...measured });
  }
  if (!result.curve?.length && result.heightM && result.periodS) {
    merged.push({
      time: new Date(result.startedAt).toTimeString().slice(0, 5),
      hour: new Date(result.startedAt).getHours() + new Date(result.startedAt).getMinutes() / 60,
      heightM: result.heightM,
      periodS: result.periodS,
      depthM: result.depthM ?? 0,
      confidence: result.confidence,
      surfScore: result.surf.score,
      waveCount: result.waves.length,
    });
  }
  return merged.sort((a, b) => a.hour - b.hour);
}

function speak(text: string): void {
  if (!('speechSynthesis' in window)) {
    toast('当前浏览器不支持语音合成', 'bad');
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = 0.96;
  window.speechSynthesis.speak(utter);
  toast('正在语音预览，再次点击不会叠加', 'info');
}
