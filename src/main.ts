import './styles.css';
import { h, clear } from './lib/ui';
import { renderCamerasPage } from './pages/cameras';
import { renderCalibrationPage } from './pages/calibration';
import { renderAnalysisPage } from './pages/analysis';
import { renderReportPage } from './pages/report';

const routes = {
  '#/cameras': { label: '摄像头管理', icon: '📷', render: renderCamerasPage },
  '#/calibration': { label: '相机标定', icon: '📐', render: renderCalibrationPage },
  '#/analysis': { label: '浪况分析', icon: '🌊', render: renderAnalysisPage },
  '#/report': { label: '每日播报', icon: '📣', render: renderReportPage },
} as const;

type RouteKey = keyof typeof routes;

function currentRoute(): RouteKey {
  const hash = window.location.hash.split('?')[0] as RouteKey;
  if (hash.startsWith('#/calibration')) return '#/calibration';
  if (hash.startsWith('#/analysis')) return '#/analysis';
  return routes[hash] ? hash : '#/analysis';
}

let cleanup: (() => void) | void;

function renderApp(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  cleanup?.();
  clear(app);
  const route = currentRoute();

  const nav = h(
    'nav',
    { class: 'nav', 'aria-label': '主导航' },
    ...Object.entries(routes).map(([hash, item]) =>
      h(
        'a',
        {
          class: `nav-link ${route === hash ? 'active' : ''}`,
          href: hash,
        },
        h('span', { class: 'ico' }, item.icon),
        h('span', {}, item.label),
      ),
    ),
  );

  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'brand-mark' }, '瞳'),
      h('div', {}, h('div', { class: 'brand-title' }, '岸瞳 SurfCam'), h('div', { class: 'brand-sub' }, '视频测浪 · 浅海反演')),
    ),
    nav,
    h(
      'div',
      { class: 'side-foot' },
      h('div', {}, h('span', { class: 'status-dot' }), 'Worker 检测引擎就绪'),
      h('div', { class: 'mt-2' }, '白沫跟踪 / 周期 / 波高 / 水深 / 卷浪方向'),
    ),
  );

  const main = h('main', { class: 'main' });
  const shell = h('div', { class: 'app-shell' }, sidebar, main);
  app.append(shell);
  cleanup = routes[route].render(main);
}

window.addEventListener('hashchange', renderApp);
if (!window.location.hash) window.location.hash = '#/analysis';
renderApp();
