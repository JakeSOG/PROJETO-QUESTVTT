// Utilitários de interface: criação de elementos, janelas, avisos, menus e diálogos.

// Rede de segurança: append/replaceChildren ignoram null, undefined e false,
// para que partes opcionais da interface (ex.: "gm ? botão : null") não virem o texto "null".
for (const method of ['append', 'replaceChildren', 'prepend']) {
  const original = Element.prototype[method];
  Element.prototype[method] = function (...nodes) {
    return original.apply(this, nodes.filter(n => n !== null && n !== undefined && n !== false));
  };
}

// h('div.classe#id', {attrs}, filhos...)
export function h(tag, attrs, ...children) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(message, type = 'info', ms = 3500) {
  const box = document.getElementById('toasts');
  const el = h('div.toast', { class: `toast ${type}` }, message);
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

// -------- Janelas flutuantes --------
let zTop = 100;
const windows = new Map();

export function openWindow({ id, title, width = 420, height = null, content, footer = null, onClose, x, y, className = '' }) {
  if (id && windows.has(id)) {
    const w = windows.get(id);
    w.focus();
    if (content) w.setContent(content);
    if (title) w.setTitle(title);
    return w;
  }
  const root = document.getElementById('windows');
  const head = h('div.win-head', h('h3', title || ''), h('button.icon.ghost', { title: 'Fechar', onclick: () => api.close() }, '✕'));
  const body = h('div.win-body');
  const foot = h('div.win-foot');
  const el = h('div.window.frame', { class: `window frame ${className}` }, head, body, foot);
  el.style.width = `${Math.min(width, window.innerWidth - 20)}px`;
  if (height) el.style.height = `${Math.min(height, window.innerHeight - 20)}px`;
  const count = windows.size;
  el.style.left = `${x ?? Math.max(10, (window.innerWidth - 370 - width) / 2 + count * 24)}px`;
  el.style.top = `${y ?? 60 + count * 24}px`;
  el.style.zIndex = ++zTop;
  root.append(el);

  const api = {
    el, body, foot, id,
    focus() { el.style.zIndex = ++zTop; },
    setTitle(t) { head.querySelector('h3').textContent = t; },
    setContent(c) { body.replaceChildren(...(Array.isArray(c) ? c : [c])); },
    setFooter(f) { foot.replaceChildren(...(Array.isArray(f) ? f : [f]).filter(Boolean)); foot.classList.toggle('hidden', !f || (Array.isArray(f) && !f.length)); },
    close() { el.remove(); if (id) windows.delete(id); if (onClose) onClose(); }
  };
  if (content) api.setContent(content);
  api.setFooter(footer);
  el.addEventListener('pointerdown', () => api.focus());

  // Arrastar pela barra de título
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY;
    const ox = el.offsetLeft, oy = el.offsetTop;
    const move = (ev) => {
      el.style.left = `${Math.max(-el.offsetWidth + 80, Math.min(window.innerWidth - 80, ox + ev.clientX - sx))}px`;
      el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, oy + ev.clientY - sy))}px`;
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  if (id) windows.set(id, api);
  return api;
}

export function getWindow(id) { return windows.get(id); }
export function closeWindow(id) { windows.get(id)?.close(); }

// Diálogo de confirmação (Promise<boolean>)
export function confirmDialog(title, message, { okLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const w = openWindow({
      title, width: 380,
      content: h('p', { html: message }),
      onClose: () => { if (!done) resolve(false); }
    });
    w.setFooter([
      h('button', { onclick: () => { done = true; resolve(false); w.close(); } }, 'Cancelar'),
      h('button', { class: danger ? 'primary' : '', onclick: () => { done = true; resolve(true); w.close(); } }, okLabel)
    ]);
  });
}

// Formulário simples: fields = [{name, label, type, value, options, min, max, step}]
export function formDialog(title, fields, { okLabel = 'Salvar', width = 420, intro = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const inputs = {};
    const grid = h('div.form-grid');
    for (const f of fields) {
      let input;
      if (f.type === 'select') {
        input = h('select', (f.options || []).map(o => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { rows: f.rows || 5 }, f.value ?? '');
      } else if (f.type === 'checkbox') {
        input = h('input', { type: 'checkbox', checked: !!f.value });
      } else {
        input = h('input', { type: f.type || 'text', value: f.value ?? '', min: f.min, max: f.max, step: f.step, placeholder: f.placeholder || '' });
      }
      inputs[f.name] = input;
      if (f.type === 'textarea' || f.full) grid.append(h('label.full', f.label), h('div.full', input));
      else grid.append(h('label', f.label), input);
    }
    const w = openWindow({ title, width, content: [intro ? h('p.muted.small', intro) : null, grid].filter(Boolean), onClose: () => { if (!done) resolve(null); } });
    const submit = () => {
      const out = {};
      for (const f of fields) {
        const i = inputs[f.name];
        out[f.name] = f.type === 'checkbox' ? i.checked : f.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value;
      }
      done = true; resolve(out); w.close();
    };
    w.setFooter([h('button', { onclick: () => { done = true; resolve(null); w.close(); } }, 'Cancelar'), h('button.primary', { onclick: submit }, okLabel)]);
    w.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit(); });
    setTimeout(() => Object.values(inputs)[0]?.focus(), 30);
  });
}

// Menu de contexto
let openMenu = null;
export function contextMenu(x, y, items) {
  closeMenu();
  const menu = h('div.ctx-menu.frame');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { menu.append(h('div.sep')); continue; }
    menu.append(h('button', { onclick: () => { closeMenu(); it.action(); } }, it.label));
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  openMenu = menu;
  setTimeout(() => window.addEventListener('pointerdown', onAway, true), 0);
}
function onAway(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
export function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
  window.removeEventListener('pointerdown', onAway, true);
}

// Tooltip com HTML (usado nos estados e perícias)
let tip = null;
export function tooltip(el, htmlOrFn) {
  el.addEventListener('mouseenter', (e) => {
    const html = typeof htmlOrFn === 'function' ? htmlOrFn() : htmlOrFn;
    if (!html) return;
    tip = h('div.tooltip', { html });
    document.body.append(tip);
    place(e);
  });
  el.addEventListener('mousemove', place);
  el.addEventListener('mouseleave', () => { tip?.remove(); tip = null; });
  function place(e) {
    if (!tip) return;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - r.width - 6)}px`;
    tip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - r.height - 6)}px`;
  }
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.click();
  });
}

export function downloadJSON(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function readJSONFile() {
  const f = await pickFile('application/json,.json');
  if (!f) return null;
  try { return JSON.parse(await f.text()); } catch { toast('Arquivo JSON inválido.', 'error'); return null; }
}

export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
