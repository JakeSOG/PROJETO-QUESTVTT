// Compêndio navegável e pesquisável (armas, Arcanos, Marcas, estados, bestiário...).
import { state, on, isGM } from '../state.js';
import { h, openWindow } from '../ui.js';

export function compendiumPanel(app, panel) {
  const packSel = h('select', { style: { flex: 1 } });
  const search = h('input', { type: 'search', placeholder: 'Pesquisar em tudo…', style: { width: '100%' } });
  const head = h('div.panel-head', { style: { flexDirection: 'column', alignItems: 'stretch' } }, h('div.row', packSel), search);
  const body = h('div.panel-body');
  panel.append(head, body);
  let pack = localStorage.getItem('qvtt.pack') || '';

  function packs() {
    const list = Object.entries(state.system.compendium).map(([id, p]) => ({ id, label: p.label, entries: p.entries }));
    // Estados vêm das regras (não do compêndio), mas são úteis para consulta.
    const states = state.system.rules.states?.states;
    if (states) list.push({ id: '_states', label: 'Estados', entries: states });
    return list;
  }

  function render() {
    const all = packs();
    if (!all.some(p => p.id === pack)) pack = all[0]?.id || '';
    packSel.replaceChildren(h('option', { value: '*' , selected: pack === '*' }, '— Todos —'), ...all.map(p => h('option', { value: p.id, selected: p.id === pack }, `${p.label} (${p.entries.length})`)));
    const q = norm(search.value);
    const shown = pack === '*' || q ? all.filter(p => pack === '*' || p.id === pack || q) : all.filter(p => p.id === pack);
    body.replaceChildren();
    let count = 0;
    for (const p of shown) {
      const entries = p.entries.filter(e => !q || norm(e.name).includes(q) || norm(e.text || '').includes(q));
      if (!entries.length) continue;
      if (shown.length > 1) body.append(h('div.group-title', p.label));
      for (const e of entries) {
        count++;
        const sub = app.system?.compendiumSubtitle ? app.system.compendiumSubtitle(p.id, e) : '';
        const el = h('div.list-item', { draggable: 'true', title: 'Clique para ler. Arraste para uma ficha ou (bestiário) para o mapa.' },
          h('div.thumb', e.icon || (p.label[0])),
          h('div.grow', h('div.name', e.name), sub ? h('div.small.muted', { html: sub }) : null));
        el.addEventListener('click', () => openEntry(p, e));
        el.addEventListener('dragstart', (ev) => {
          const data = JSON.stringify({ type: 'compendium', pack: p.id, id: e.id });
          ev.dataTransfer.setData('application/x-questvtt', data);
          ev.dataTransfer.setData('text/plain', data);
        });
        body.append(el);
      }
    }
    if (!count) body.append(h('p.muted', 'Nada encontrado.'));
  }

  function openEntry(p, e) {
    const content = app.system?.renderCompendiumEntry ? app.system.renderCompendiumEntry(p.id, e, app) : h('pre', JSON.stringify(e, null, 2));
    openWindow({ id: `comp-${p.id}-${e.id}`, title: e.name, width: 460, content });
  }
  app.openCompendiumEntry = (packId, id) => {
    const p = packs().find(x => x.id === packId);
    const e = p?.entries.find(x => x.id === id);
    if (p && e) openEntry(p, e);
  };

  packSel.addEventListener('change', () => { pack = packSel.value; try { localStorage.setItem('qvtt.pack', pack); } catch { /* ok */ } render(); });
  search.addEventListener('input', render);
  on('world:reset', render);
  on('system', render);
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
