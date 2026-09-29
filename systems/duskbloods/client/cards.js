// Cartões de rolagem no chat: dados individuais com sucessos em vermelho-sangue,
// resultado contra o Limiar, dano separado (base / excedentes / truque) e botões.
import { ctx, h, esc, act, isGM, R } from './util.js';

export function renderDice(pool) {
  const core = R().core;
  const box = h('div.dice');
  for (const chain of pool.chains || []) {
    chain.forEach((v, i) => {
      const cls = ['die'];
      if (v >= core.dice.successMin) cls.push('success');
      if (core.dice.explode && v >= core.dice.explodeOn) cls.push('explode');
      if (v === 1 && i === 0) cls.push('one');
      if (i > 0) cls.push('chain');
      box.append(h('span', { class: cls.join(' '), title: i > 0 ? 'Explosão' : '' }, v));
    });
    box.append(h('span', { style: { width: '4px' } }));
  }
  if (pool.critFail?.rerolls?.length) {
    box.append(h('span.muted.small', ' 1s rolados de novo: '));
    for (const v of pool.critFail.rerolls) box.append(h('span', { class: `die ${v === 1 ? 'reroll' : ''}` }, v));
  }
  return box;
}

function resultBadge(pool) {
  if (pool.target == null) return h('span.roll-result.fail', `${pool.successes} sucesso(s)`);
  if (pool.critical) return h('span.roll-result.crit', `SUCESSO CRÍTICO · ${pool.successes}/${pool.target} (+${pool.excess})`);
  if (pool.passed) return h('span.roll-result.pass', `SUCESSO · ${pool.successes}/${pool.target}${pool.excess ? ` (+${pool.excess} excedente${pool.excess > 1 ? 's' : ''})` : ''}`);
  if (pool.criticalFailure) return h('span.roll-result.critfail', `FALHA CRÍTICA · ${pool.successes}/${pool.target}${pool.critFail?.severity > 1 ? ` (${pool.critFail.severity} falhas)` : ''}`);
  return h('span.roll-result.fail', `FALHA · ${pool.successes}/${pool.target}`);
}

function poolBlock(pool) {
  return h('div',
    h('div.row', h('span.card-sub', `${pool.count}D6`), resultBadge(pool)),
    renderDice(pool),
    pool.parts?.length ? h('details.pool-parts', h('summary', 'composição do pool'), h('div.small.muted', pool.parts.join(' · '))) : null);
}

export function renderChatCard(msg, el) {
  const d = msg.data;
  switch (d.card) {
    case 'test': return el.append(testCard(d));
    case 'attack': return el.append(attackCard(msg, d));
    case 'info': return el.append(infoCard(d));
    case 'damage': return el.append(damageCard(d));
    case 'dying': return el.append(dyingCard(d));
    default: el.textContent = JSON.stringify(d);
  }
}

function testCard(d) {
  return h('div',
    h('div.card-title', d.title || 'Teste'),
    d.actor ? h('div.card-sub', d.actor) : null,
    d.pool ? poolBlock(d.pool) : null,
    notes(d.notes));
}

function notes(list) {
  if (!list || !list.length) return null;
  return h('ul.card-lines', ...list.map(n => h('li', { html: n })));
}

function attackCard(msg, d) {
  const box = h('div',
    h('div.card-title', `${d.title}`),
    h('div.card-sub', `${d.attacker}${d.weapon ? ` — ${d.weapon}` : ''}${d.cost ? ` · ${d.cost} PA` : ''}`),
    d.text ? h('div.small.muted', { style: { fontStyle: 'italic' } }, d.text) : null);
  if (d.pool) box.append(h('div.row', h('span.card-sub', `${d.pool.count}D6 · ${d.pool.successes} sucesso(s)`)), renderDice(d.pool),
    d.pool.parts?.length ? h('details.pool-parts', h('summary', 'composição do pool'), h('div.small.muted', d.pool.parts.join(' · '))) : null);
  (d.results || []).forEach((r, i) => box.append(resultBlock(msg, d, r, i)));
  box.append(notes(d.notes));
  return box;
}

function resultBlock(msg, d, r, index) {
  const block = h('div.card-block');
  const head = h('div.row', h('b', `➜ ${r.targetName || 'Alvo'}`));
  if (r.countered && r.counter?.hit) head.append(h('span.roll-result.crit', 'INTERROMPIDO PELO CONTRA-TIRO'));
  else if (r.support) head.append(h('span.muted.small', 'efeito'));
  else if (r.auto) head.append(h('span.roll-result.pass', 'ACERTO AUTOMÁTICO'));
  else if (r.visceral) head.append(h('span.roll-result.crit', 'ATAQUE VISCERAL'));
  else if (r.limiar != null) {
    const txt = r.passed ? (r.critical ? `CRÍTICO! (+${r.excess})` : `ACERTOU${r.excess ? ` (+${r.excess})` : ''}`) : 'ERROU';
    const badge = h('span', { class: `roll-result ${r.passed ? (r.critical ? 'crit' : 'pass') : 'fail'}` }, `${txt} · Limiar ${r.limiar}`);
    ctx.app.ui.tooltip(badge, () => (r.limiarParts || []).map(esc).join('<br>'));
    head.append(badge);
  }
  block.append(head);
  if (r.countered && !r.counter?.hit) block.append(h('div.small.muted', 'Contra-Tiro falhou; o golpe segue.'));
  if (r.pool) block.append(renderDice(r.pool), h('div.small.muted', `${r.pool.successes} sucesso(s)`));
  if (r.damage) {
    block.append(h('div.row', h('span.roll-total', `${r.damage.total}`), h('span.muted', 'de dano'), r.dealt != null && r.dealt !== r.damage.total ? h('span.small.muted', `(${r.dealt} na Vida)`) : null, r.hpAfter != null && isGM() ? h('span.small.muted', `Vida ${r.hpAfter}`) : null));
    block.append(h('details.pool-parts', h('summary', 'cálculo do dano'), h('ul.card-lines', ...r.damage.lines.map(l => h('li', { html: l })))));
    if (!d.applied && isGM()) block.append(applyButtons(r.damage.total, r.targetActorId));
  }
  block.append(notes(r.notes));
  // Estados que o caçador pode resistir
  (r.pendingStates || []).forEach((st, si) => {
    if (st.resolved) {
      block.append(h('div.small', `${st.name}: ${st.resolved === 'resisted' ? 'resistido ✔' : st.resolved === 'immune' ? 'imune' : 'aplicado'}`));
      return;
    }
    const actor = ctx.app.state.actors.get(r.targetActorId);
    const mine = actor && actor.full;
    const cat = st.category === 'mental' ? 'Vontade + Sanidade' : st.category === 'cosmico' ? 'Vontade + Fé' : 'Vigor + Resiliência';
    const row = h('div.card-actions', h('span.small', `${st.name} (${st.category || 'físico'}):`));
    if (mine) {
      const dif = h('select.small', ...R().core.difficulties.map(x => h('option', { value: x.successes, selected: x.successes === 2 }, `${x.name} (${x.successes})`)));
      row.append(dif, h('button.small', { title: cat, onclick: () => act('resist', { msgId: msg.id, index, stateIndex: si, difficulty: Number(dif.value) }) }, `Resistir (${cat})`));
    }
    if (isGM()) row.append(h('button.small', { onclick: () => act('resist', { msgId: msg.id, index, stateIndex: si, mode: 'apply' }) }, 'Aplicar sem teste'));
    block.append(row);
  });
  if (isGM() && d.applied && r.dealt > 0 && !r.undone) block.append(h('div.card-actions', h('button.small', { onclick: () => act('undo', { msgId: msg.id, index }) }, '↶ Desfazer dano')));
  if (r.undone) block.append(h('div.small.muted', 'Dano desfeito.'));
  return block;
}

function infoCard(d) {
  return h('div',
    h('div.card-title', d.title || ''),
    d.actor ? h('div.card-sub', `${d.actor}${d.cost ? ` · ${d.cost} PA` : ''}`) : null,
    d.pool ? poolBlock(d.pool) : null,
    d.text ? h('div', { html: d.text }) : null,
    notes(d.card === 'info' && d.pool ? d.notes : null));
}

function damageCard(d) {
  return h('div',
    h('div.card-title', d.title),
    h('div.card-sub', `${d.line}${d.type ? ` ${d.type}` : ''}`),
    h('div.roll-total', `${d.total}`),
    isGM() ? applyButtons(d.total, null, d.type, d.heal) : null);
}

// Botões de aplicar dano/cura nos tokens selecionados (ou num ator específico).
export function applyButtons(total, actorId, type = null, heal = false) {
  const pick = () => {
    if (actorId) return [actorId];
    const ids = [...ctx.app.state.selected].map(id => ctx.app.state.scene?.tokens.get(id)?.actor_id).filter(Boolean);
    if (!ids.length) ctx.app.ui.toast('Selecione um ou mais tokens no mapa.', 'error');
    return ids;
  };
  const row = h('div.card-actions');
  if (!heal) {
    row.append(
      h('button.small', { title: 'Aplicar nos selecionados (com Fraquezas, Resistências e Redução)', onclick: () => { const ids = pick(); if (ids.length) act('adjust', { actorIds: ids, amount: total, type }); } }, `⚔ Aplicar ${total}`),
      h('button.small', { onclick: () => { const ids = pick(); if (ids.length) act('adjust', { actorIds: ids, amount: total, type, half: true }); } }, '½'),
      h('button.small', { title: 'Dano Massivo (ignora Redução)', onclick: () => { const ids = pick(); if (ids.length) act('adjust', { actorIds: ids, amount: total, massive: true }); } }, 'Massivo'));
  }
  row.append(h('button.small', { onclick: () => { const ids = pick(); if (ids.length) act('adjust', { actorIds: ids, amount: total, mode: 'heal' }); } }, `✚ Curar ${total}`));
  return row;
}

function dyingCard(d) {
  const n = R().combat.dying.candles;
  const lit = d.dying?.lit ?? 0, out = d.dying?.out ?? 0;
  const candles = h('div', { style: { fontSize: '20px', letterSpacing: '4px' } },
    '🕯'.repeat(lit), h('span', { style: { opacity: 0.35 } }, '🕯'.repeat(Math.max(0, n - lit - out))), h('span', { style: { filter: 'grayscale(1)' } }, '✖'.repeat(out)));
  const box = h('div', h('div.card-title', d.title), h('div.card-sub', d.actor), poolBlock(d.pool), candles, notes(d.notes));
  const actor = ctx.app.state.actors.get(d.actorId);
  const live = actor?.data?.dying;
  if (live?.deathPending) {
    const row = h('div.card-actions');
    if (actor.full && !live.parasiteUsed) row.append(h('button.small.primary', { onclick: () => act('parasite', { actorId: actor.id }) }, `Deixar o parasita segurar (+${R().combat.dying.parasiteDementia} Dementia)`));
    if (isGM()) row.append(h('button.small', { onclick: () => act('death', { actorId: actor.id }) }, '☠ Confirmar morte'));
    box.append(row);
  }
  return box;
}

// Botões para rolagens genéricas (/r) — Mestre aplica o total como dano ou cura.
export function rollButtons(total) {
  return applyButtons(total, null);
}
