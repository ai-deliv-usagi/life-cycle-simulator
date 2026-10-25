// 小さな DOM ヘルパー(フレームワークは使わない。DESIGN.md §9)

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** 要素を作る。on〇〇 はイベント、それ以外は属性(class は className) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** 画面全体を差し替える */
export function mount(root: HTMLElement, ...children: Child[]): void {
  clear(root);
  append(root, children);
  window.scrollTo(0, 0);
}

/** モーダルを開く。戻り値で閉じる */
export function openModal(content: HTMLElement, opts: { dismissible?: boolean } = {}): () => void {
  const overlay = h('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'modal' }, content));
  const close = () => overlay.remove();
  if (opts.dismissible) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
  document.body.appendChild(overlay);
  const first = overlay.querySelector<HTMLElement>('button, input, select');
  first?.focus();
  return close;
}

/** ファイルとしてダウンロードさせる */
export function download(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
