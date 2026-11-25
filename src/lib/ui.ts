export type Child = Node | string | number | false | null | undefined;
export type ElementProps = Record<string, unknown> & { class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('aria-') || key === 'role') el.setAttribute(key, String(value));
    else if (key === 'style' && typeof value === 'string') el.style.cssText = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') {
      el.innerHTML = String(value);
    } else {
      (el as unknown as Record<string, unknown>)[key] = value;
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const child of children.flat()) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function toast(message: string, type: 'ok' | 'bad' | 'info' = 'info', timeout = 2600): void {
  let wrap = document.querySelector<HTMLDivElement>('.toast-wrap');
  if (!wrap) {
    wrap = h('div', { class: 'toast-wrap' });
    document.body.append(wrap);
  }
  const item = h('div', { class: `toast ${type === 'info' ? '' : type}` }, message);
  wrap.append(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    setTimeout(() => item.remove(), 220);
  }, timeout);
}

export function modal(content: HTMLElement, opts: { wide?: boolean; onClose?: () => void } = {}): () => void {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: `modal ${opts.wide ? 'wide' : ''}` }, content);
  backdrop.append(box);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  function close(): void {
    backdrop.remove();
    opts.onClose?.();
  }
  document.body.append(backdrop);
  return close;
}

export function downloadText(filename: string, text: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
