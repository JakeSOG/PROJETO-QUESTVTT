// Tabelas aleatórias: do sistema (encontros, mutações, rumores) e criadas pelo Mestre.
import { state, on, isGM } from '../state.js';
import { call } from '../net.js';
import { h, formDialog, confirmDialog } from '../ui.js';

export function tablesPanel(app, panel) {
  const blind = h('input', { type: 'checkbox' });
  const head = h('div.panel-head', h('h3', 'Tabelas'), isGM() ? h('label.row.small', blind, 'Oculta') : null, isGM() ? h('button.small', { onclick: () => edit() }, '+ Tabela') : null);
  const body = h('div.panel-body');
  panel.append(head, body);

  async function edit(t) {
    const r = await formDialog(t ? 'Editar tabela' : 'Nova tabela', [
      { name: 'name', label: 'Nome', value: t?.name || '' },
      { name: 'lines', label: 'Um resultado por linha', type: 'textarea', rows: 12, value: (t?.data.results || []).map(x => x.text).join('\n') }
    ], { width: 480 });
    if (r) call('rolltable:save', { id: t?.id, name: r.name, lines: r.lines });
  }

  function render() {
    body.replaceChildren();
    const sys = state.system.compendium.tables?.entries || [];
    if (sys.length) body.append(h('div.group-title', 'Do sistema'));
    for (const t of sys) body.append(row(t.name, `${t.dice} · ${t.results.length} resultados`, () => call('chat:rollTable', { id: t.id, blind: blind.checked })));
    const custom = state.rolltables;
    if (custom.length) body.append(h('div.group-title', 'Da mesa'));
    for (const t of custom) {
      const el = row(t.name, `${t.data.dice}`, () => call('chat:rollTable', { id: `u${t.id}`, blind: blind.checked }));
      if (isGM()) el.append(h('button.small.ghost', { onclick: (e) => { e.stopPropagation(); edit(t); } }, '✎'), h('button.small.ghost', { onclick: async (e) => { e.stopPropagation(); if (await confirmDialog('Apagar tabela', `Apagar <b>${t.name}</b>?`, { danger: true })) call('rolltable:delete', { id: t.id }); } }, '🗑'));
      body.append(el);
    }
  }
  function row(name, sub, roll) {
    const el = h('div.list-item', h('div.thumb', '🎲'), h('div.grow', h('div.name', name), h('div.small.muted', sub)));
    el.addEventListener('click', roll);
    return el;
  }
  on('tables', render);
  on('system', render);
  on('world:reset', render);
}
