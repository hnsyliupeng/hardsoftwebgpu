/**
 * panels.js — the GUI toolkit: sliders, toggles, selects, readouts, bar banks,
 * line charts and attention heat maps. Plain DOM + 2D canvas, no framework.
 *
 * Every factory returns a small controller object (`set`, `get`, `update`) so the
 * simulation loop can push values into the HUD without rebuilding the DOM.
 */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function panel(title, { open = true, badge = null } = {}) {
  const body = el('div', { class: 'panel-body' });
  const badgeEl = badge ? el('span', { class: 'badge', text: badge }) : null;
  const details = el('details', { class: 'panel', ...(open ? { open: '' } : {}) }, [
    el('summary', {}, [el('span', { text: title }), badgeEl]),
    body,
  ]);
  return { node: details, body, badge: badgeEl };
}

export function row(parent, children, className = 'row') {
  const r = el('div', { class: className }, children);
  parent.append(r);
  return r;
}

export function slider(parent, {
  label, min = 0, max = 1, step = 0.001, value = 0, unit = '', format = null, onInput = null, hint = null,
}) {
  const fmt = format ?? ((v) => (step < 0.01 ? v.toFixed(3) : v.toFixed(2)));
  const valueEl = el('span', { class: 'slider-value', text: `${fmt(value)}${unit}` });
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: () => {
      const v = Number(input.value);
      valueEl.textContent = `${fmt(v)}${unit}`;
      if (onInput) onInput(v);
    },
  });
  const node = el('label', { class: 'slider', title: hint ?? label }, [
    el('span', { class: 'slider-label', text: label }),
    valueEl,
    input,
  ]);
  parent.append(node);
  return {
    node,
    input,
    get: () => Number(input.value),
    set: (v) => { input.value = String(v); valueEl.textContent = `${fmt(v)}${unit}`; },
    label,
  };
}

export function toggle(parent, { label, value = false, onChange = null, hint = null }) {
  const input = el('input', { type: 'checkbox', onchange: () => onChange && onChange(input.checked) });
  input.checked = !!value;
  const node = el('label', { class: 'toggle', title: hint ?? label }, [input, el('span', { text: label })]);
  parent.append(node);
  return { node, input, get: () => input.checked, set: (v) => { input.checked = !!v; } };
}

export function select(parent, { label, options, value, onChange = null }) {
  const node0 = el('select', {
    onchange: () => onChange && onChange(node0.value),
  }, options.map((o) => el('option', { value: o.value, text: o.label, ...(o.value === value ? { selected: '' } : {}) })));
  const node = el('label', { class: 'select' }, [el('span', { text: label }), node0]);
  parent.append(node);
  return { node, input: node0, get: () => node0.value, set: (v) => { node0.value = v; } };
}

export function button(parent, { label, onClick, kind = '', title = '' }) {
  const node = el('button', { class: `btn ${kind}`, text: label, title, onclick: onClick });
  parent.append(node);
  return { node, label, setDisabled: (d) => { node.disabled = !!d; }, setLabel: (t) => { node.textContent = t; } };
}

export function buttonRow(parent, items) {
  const r = el('div', { class: 'btn-row' });
  parent.append(r);
  return items.map((it) => button(r, it));
}

export function readout(parent, { label, value = '—', unit = '', wide = false }) {
  const valueEl = el('span', { class: 'readout-value', text: value });
  const node = el('div', { class: `readout${wide ? ' wide' : ''}` }, [
    el('span', { class: 'readout-label', text: label }),
    el('span', {}, [valueEl, unit ? el('span', { class: 'readout-unit', text: unit }) : null]),
  ]);
  parent.append(node);
  return { node, set: (v) => { valueEl.textContent = typeof v === 'number' ? v.toFixed(2) : String(v); } };
}

/** Row of labelled bars (tensions, bends, cable speeds). */
export function barBank(parent, { labels, min = 0, max = 1, color = '#5ac8fa', unit = '' }) {
  const bars = labels.map(() => el('span', { class: 'bar-fill' }));
  const values = labels.map(() => el('span', { class: 'bar-value', text: '—' }));
  const node = el('div', { class: 'bar-bank' }, labels.map((l, i) => el('div', { class: 'bar-row' }, [
    el('span', { class: 'bar-label', text: l }),
    el('span', { class: 'bar-track', style: { '--bar-color': color } }, [bars[i]]),
    values[i],
  ])));
  parent.append(node);
  const span = Math.max(max - min, 1e-9);
  return {
    node,
    set: (arr, scale = 1) => {
      for (let i = 0; i < bars.length; i += 1) {
        const v = arr?.[i] ?? 0;
        const ratio = Math.max(0, Math.min(1, (v * scale - min) / span));
        bars[i].style.width = `${(ratio * 100).toFixed(1)}%`;
        values[i].textContent = `${v.toFixed(2)}${unit}`;
      }
    },
  };
}

/** Scrolling line chart for loss / force / torque history. */
export function chart(parent, { width = 300, height = 90, series = 1, colors = ['#5ac8fa', '#ffd166', '#ef476f'], labels = [] } = {}) {
  const canvas = el('canvas', { class: 'chart', width: width * 2, height: height * 2, style: { width: `${width}px`, height: `${height}px` } });
  const ctx = canvas.getContext('2d');
  const data = Array.from({ length: series }, () => []);
  const legend = labels.length ? el('div', { class: 'legend' }, labels.map((l, i) => el('span', { class: 'legend-item' }, [
    el('span', { class: 'legend-dot', style: { background: colors[i % colors.length] } }),
    l,
  ]))) : null;
  const node = el('div', { class: 'chart-wrap' }, [canvas, legend]);
  parent.append(node);

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,14,22,0.72)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,150,190,0.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of data) for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { hi = lo + 1e-6; }
    const pad = (hi - lo) * 0.1;
    lo -= pad; hi += pad;
    for (let si = 0; si < data.length; si += 1) {
      const s = data[si];
      if (s.length < 2) continue;
      ctx.strokeStyle = colors[si % colors.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      const n = s.length;
      for (let i = 0; i < n; i += 1) {
        const x = (i / (n - 1)) * w;
        const y = h - ((s[i] - lo) / (hi - lo)) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // last-point dot
      const y = h - ((s[n - 1] - lo) / (hi - lo)) * h;
      ctx.fillStyle = colors[si % colors.length];
      ctx.beginPath();
      ctx.arc(w - 3, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(200,215,235,0.65)';
    ctx.font = '18px ui-monospace, monospace';
    ctx.fillText(hi.toFixed(3), 6, 20);
    ctx.fillText(lo.toFixed(3), 6, h - 6);
  }
  draw();
  return {
    node, canvas, data,
    push: (values) => {
      values.forEach((v, i) => {
        const s = data[i];
        s.push(v);
        if (s.length > 240) s.shift();
      });
      draw();
    },
    setData: (i, arr) => { data[i] = arr.slice(-240); draw(); },
    clear: () => { data.forEach((s) => (s.length = 0)); draw(); },
    draw,
  };
}

/** Attention heat map (transformer policy introspection). */
export function heatmap(parent, { rows = 8, cols = 8, size = 132 } = {}) {
  const canvas = el('canvas', { class: 'heatmap', width: size * 2, height: size * 2, style: { width: `${size}px`, height: `${size}px` } });
  const ctx = canvas.getContext('2d');
  const node = el('div', { class: 'chart-wrap' }, [canvas]);
  parent.append(node);
  const state = { rows, cols, matrix: null };
  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,14,22,0.85)';
    ctx.fillRect(0, 0, w, h);
    const m = state.matrix;
    if (!m || !m.length) {
      ctx.fillStyle = 'rgba(180,200,225,0.5)';
      ctx.font = '20px ui-monospace, monospace';
      ctx.fillText('policy idle', 12, 28);
      return;
    }
    const cw = w / state.cols;
    const ch = h / state.rows;
    for (let r = 0; r < state.rows; r += 1) {
      for (let c = 0; c < state.cols; c += 1) {
        const v = Math.max(0, Math.min(1, m[r * state.cols + c] ?? 0));
        ctx.fillStyle = `hsl(${(210 - v * 200).toFixed(0)} 85% ${(12 + v * 58).toFixed(0)}%)`;
        ctx.fillRect(c * cw, r * ch, cw - 1, ch - 1);
      }
    }
  }
  draw();
  return { node, set: (matrix) => { state.matrix = matrix; draw(); } };
}

/** Objective/stage list with click selection. */
export function taskList(parent, items, { onPick = null, onHover = null } = {}) {
  const nodes = items.map((it, i) => el('button', { class: 'task-item', onclick: () => onPick && onPick(i), onmouseenter: () => onHover && onHover(i) }, [
    el('span', { class: 'task-name', text: it.name }),
    el('span', { class: 'task-sub', text: it.subtitle ?? '' }),
  ]));
  const node = el('div', { class: 'task-list' }, nodes);
  parent.append(node);
  return {
    node,
    select: (i) => nodes.forEach((n, k) => n.classList.toggle('active', k === i)),
    nodes,
  };
}

/** Floating HUD label anchored to a world position (updated from the loop). */
export function hudLabel(parent, { text = '', color = '#8ff0ff' } = {}) {
  const node = el('div', { class: 'hud-label', style: { color } }, [el('span', { text })]);
  parent.append(node);
  return {
    node,
    set: (t) => { node.firstChild.textContent = t; },
    place: (screen, visible = true) => {
      node.style.display = visible ? 'block' : 'none';
      if (screen) {
        node.style.transform = `translate(${(screen.x * 100).toFixed(2)}vw, ${(screen.y * 100).toFixed(2)}vh) translate(-50%, -50%)`;
      }
    },
  };
}

export function toast(container, message, ms = 2600) {
  const node = el('div', { class: 'toast', text: message });
  container.append(node);
  setTimeout(() => node.classList.add('show'), 10);
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 400);
  }, ms);
  return node;
}
