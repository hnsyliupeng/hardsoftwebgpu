/* Minimal DOM shim so the real app modules can be executed in Node:
   catches typos, bad widget APIs and boot-time crashes without a browser. */
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, force) { const on = force ?? !this.set.has(c); if (on) this.set.add(c); else this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
}
let ctx2d = null;
function makeCtx() {
  const noop = () => {};
  return {
    clearRect: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    arc: noop, fill: noop, fillText: noop, strokeRect: noop, closePath: noop, save: noop, restore: noop,
    translate: noop, scale: noop, setTransform: noop, createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop, drawImage: noop,
    strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
  };
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => { t[k] = v; return true; } });
    this.classList = new ClassList();
    this.dataset = {};
    this.attributes = {};
    this._text = '';
    this.listeners = {};
    this.parent = null;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.open = false;
    this.width = 300; this.height = 150;
    this.clientWidth = 1280; this.clientHeight = 720;
    this._ctx = null;
  }
  get firstChild() { return this.children[0] ?? null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  set innerHTML(v) { this.children = []; this._text = String(v); }
  get innerHTML() { return this._text; }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  removeEventListener() {}
  dispatch(t, ev) { (this.listeners[t] ?? []).forEach((f) => f(ev)); }
  getContext(kind) { if (kind !== '2d') return null; return (this._ctx ??= makeCtx()); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }; }
  setPointerCapture() {}
  toDataURL() { return 'data:image/png;base64,'; }
  querySelector() { return null; }
  focus() {}
}
const byId = new Map();
const root = new El('div');
const ids = ['view', 'overlay', 'left', 'right', 'foot-left', 'foot-right', 'error', 'boot', 'boot-msg',
  'help', 'help-btn', 'fps', 'sps', 'mode-status', 'sim-time', 'gpu-status', 'stage', 'app', 'version', 'paper'];
for (const id of ids) { const e = new El(id === 'view' ? 'canvas' : 'div'); e.id = id; byId.set(id, e); root.appendChild(e); }
const rafQueue = [];
let rafCount = 0;
globalThis.window = {
  devicePixelRatio: 2,
  addEventListener() {},
  innerWidth: 1600, innerHeight: 900,
  requestAnimationFrame: (f) => { rafQueue.push(f); return rafQueue.length; },
};
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => { const e = new El('#text'); e.textContent = t; return e; },
  getElementById: (id) => byId.get(id) ?? new El('div'),
  body: new El('body'),
  documentElement: new El('html'),
  addEventListener() {},
};
globalThis.requestAnimationFrame = (f) => { rafQueue.push(f); return (rafCount += 1); };
globalThis.cancelAnimationFrame = () => {};
globalThis.self = globalThis;
globalThis.__drainRaf = (n = 4) => {
  for (let i = 0; i < n; i += 1) {
    const f = rafQueue.shift();
    if (!f) break;
    f(performance.now() + i * 16.7);
  }
};
export { root, byId, rafQueue };
export const __drainRaf = (n = 4) => globalThis.__drainRaf(n);
