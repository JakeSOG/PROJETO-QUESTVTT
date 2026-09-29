// Rastreador de combate: rodada, lado ativo, PA de cada combatente, token ativo.
import { state, on, isGM, canControl } from '../state.js';
import { call } from '../net.js';
import { h, confirmDialog } from '../ui.js';

const SIDE_NAMES = { hunters: 'Caçadores', creatures: 'Criaturas' };

export function combatPanel(app, panel) {
  const head = h('div.panel-head');
  const body = h('div.panel-body');
  panel.append(head, body);

  function render() {
    const c = state.combat;
    head.replaceChildren(h('h3', c ? (c.data.started ? `Rodada ${c.data.round}` : 'Preparando combate') : 'Sem combate'));
    body.replaceChildren();
    if (!c) {
      if (isGM()) {
        body.append(
          h('p.muted', 'Inicie um combate com todos os tokens da cena, ou apenas com os selecionados.'),
          h('div.col',
            h('button.primary', { onclick: () => call('combat:start', {}) }, '⚔ Iniciar combate (toda a cena)'),
            h('button', { onclick: () => call('combat:start', { tokenIds: [...state.selected] }), disabled: !state.selected.size }, 'Iniciar com os tokens selecionados')));
      } else body.append(h('p.muted', 'Nenhum combate em andamento.'));
      return;
    }
    const d = c.data;
    if (isGM()) {
      const ctrl = h('div.row', { style: { marginBottom: '8px' } });
      if (!d.started) {
        ctrl.append(
          h('button', { onclick: () => call('combat:initiative', { mode: 'roll' }) }, '🎲 Rolar iniciativa'),
          h('button', { onclick: () => call('combat:initiative', { mode: 'hunters' }) }, 'Caçadores primeiro'),
          h('button', { onclick: () => call('combat:initiative', { mode: 'creatures' }) }, 'Criaturas primeiro'),
          h('button.primary', { onclick: () => call('combat:begin') }, `Começar (${SIDE_NAMES[d.firstSide] || d.firstSide} agem primeiro)`));
      } else {
        ctrl.append(h('button.primary', { onclick: () => call('combat:next') }, `Passar o turno ➜ ${SIDE_NAMES[nextSide(d)]}`));
      }
      ctrl.append(
        h('button', { title: 'Adicionar tokens selecionados', onclick: () => call('combat:add', { tokenIds: [...state.selected] }), disabled: !state.selected.size }, '+ Selecionados'),
        h('button', { onclick: async () => { if (await confirmDialog('Encerrar combate', 'Encerrar o combate? A Guarda dos caçadores volta ao máximo.', { danger: true, okLabel: 'Encerrar' })) call('combat:end'); } }, 'Encerrar'));
      body.append(ctrl);
    }
    if (d.started) body.append(h('div.ornament', { style: { margin: '6px 0 10px' } }, `Turno: ${SIDE_NAMES[d.side] || d.side}`));

    for (const side of d.sides) {
      const list = c.combatants.filter(cb => cb.data.side === side);
      if (!list.length) continue;
      body.append(h('div.group-title', { style: { color: d.side === side ? 'var(--blood-2)' : '' } }, `${SIDE_NAMES[side] || side}${d.side === side ? ' — agindo' : ''}`));
      for (const cb of list) body.append(renderCombatant(cb, d));
    }
  }

  function nextSide(d) {
    const i = d.sides.indexOf(d.side);
    return d.sides[(i + 1) % d.sides.length];
  }

  function renderCombatant(cb, d) {
    const actor = state.actors.get(cb.actor_id);
    const token = state.scene?.tokens.get(cb.token_id);
    const name = token?.data.name || actor?.name || '???';
    const info = actor && app.system?.combatantInfo ? app.system.combatantInfo(actor) : null;
    const mine = actor && canControl(actor);
    const active = d.activeCombatantId === cb.id;
    const el = h('div.list-item', { class: `list-item ${active ? 'active' : ''}` },
      token?.data.img ? h('img.thumb', { src: token.data.img, alt: '' }) : h('div.thumb', name.slice(0, 2).toUpperCase()),
      h('div.grow',
        h('div.name', name, cb.data.done ? ' ✓' : ''),
        info ? h('div.small.muted', { html: info }) : null),
      mine && d.started && d.side === cb.data.side ? h('button.small', { title: 'Marcar como quem está agindo', onclick: (e) => { e.stopPropagation(); call('combat:activate', { id: cb.id }); } }, '▶') : null,
      mine && d.started && d.side === cb.data.side && !isGM() ? h('button.small', { title: 'Terminei meu turno', onclick: (e) => { e.stopPropagation(); call('combat:done', { id: cb.id, done: !cb.data.done }); } }, cb.data.done ? 'Desfazer' : 'Pronto') : null,
      isGM() ? h('button.small.ghost', { title: 'Remover do combate', onclick: (e) => { e.stopPropagation(); call('combat:remove', { id: cb.id }); } }, '✕') : null);
    el.addEventListener('click', () => {
      if (token && app.board) { const c = app.board.tokenCenter(token); app.board.centerOn(c.x, c.y); }
    });
    el.addEventListener('dblclick', () => { if (actor && app.system?.openSheet) app.system.openSheet(actor); });
    return el;
  }

  on('combat', render);
  on('actors', render);
  on('selection', render);
  on('scene', render);
  on('world:reset', render);
}
