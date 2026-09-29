// Ficha de criatura (Mestre): Limiar, Dados, Vida, PA, Fraquezas, ataques, fases de Chefe.
import { ctx, h, R, act, isGM, call, esc, stateChip, damageText, tierDef } from './util.js';
import { creatureAttackDialog } from './dialogs.js';

export function openCreatureSheet(actorId) {
  const app = ctx.app;
  const winId = `sheet-${actorId}`;
  if (app.ui.getWindow(winId)) { app.ui.getWindow(winId).focus(); return; }
  const win = app.ui.openWindow({ id: winId, title: '', width: 620, height: 680 });
  const actor = () => app.state.actors.get(actorId);
  const upd = (data) => call('actor:update', { id: actorId, data });

  function render() {
    const a = actor();
    if (!a) { win.close(); return; }
    const focused = document.activeElement?.dataset?.key;
    const scroll = win.body.scrollTop;
    win.setTitle(a.name);
    if (!a.full) { win.setContent(publicView(a)); return; }
    const d = a.data, dv = a.derived;
    const tier = tierDef(d.tier);
    const num = (key, value, onChange, opts = {}) => {
      const i = h('input', { type: 'number', value: value ?? '', 'data-key': key, placeholder: opts.placeholder || '', style: { width: opts.w || '64px' } });
      i.addEventListener('change', () => onChange(i.value === '' ? null : Number(i.value)));
      return i;
    };
    const name = h('input.sheet-name', { value: a.name, 'data-key': 'name' });
    name.addEventListener('change', () => call('actor:update', { id: a.id, name: name.value }));
    const tierSel = h('select', ...R().combat.creatureTiers.map(t => h('option', { value: t.id, selected: t.id === d.tier }, `${t.name} (peso ${t.weight})`)));
    tierSel.addEventListener('change', () => upd({ tier: tierSel.value }));
    const listInput = (key, list) => {
      const i = h('input', { value: (list || []).join(', '), 'data-key': key, placeholder: 'Ignis, Umbra…' });
      i.addEventListener('change', () => upd({ [key]: i.value.split(',').map(s => s.trim()).filter(Boolean).map(s => R()['damage-types'].types.find(t => t.id.toLowerCase() === s.toLowerCase())?.id || s) }));
      return i;
    };
    const portrait = h('div.portrait', { title: 'Clique para trocar a imagem' }, a.img ? h('img', { src: a.img, alt: '' }) : h('span', a.name.slice(0, 2).toUpperCase()));
    portrait.addEventListener('click', async () => { const f = await app.ui.pickFile('image/*'); if (!f) return; const url = await app.upload('token', f); if (url) call('actor:update', { id: a.id, img: url }); });

    const stats = h('div.form-grid',
      h('label', 'Limiar'), h('div.row', num('limiar', d.limiar, v => upd({ limiar: v }), { placeholder: 'Desconhecido' }), h('span.small.muted', `atual: ${dv.limiar}${dv.limiar !== d.limiar ? ` (${dv.limiarBreakdown.join(', ')})` : ''}`)),
      h('label', 'Dados de ataque'), num('dice', d.dice, v => upd({ dice: v }), { placeholder: '?' }),
      h('label', 'Vida'), h('div.row', num('hp', d.hp?.value, v => upd({ hp: { value: v } })), h('span', '/'), num('hpmax', d.hp?.max, v => upd({ hp: { max: v } })), d.hpPerHunter ? h('span.small.muted', `(${d.hpPerHunter} por caçador)`) : null),
      h('label', 'PA'), h('div.row', num('pa', d.pa?.value, v => upd({ pa: { value: v } })), h('span', '/'), num('pamax', d.pa?.max, v => upd({ pa: { max: v } })), d.maxAttacksPerTurn ? h('span.small.muted', `máx. ${d.maxAttacksPerTurn} ataques/turno`) : null),
      h('label', 'Redução de Dano'), num('dr', d.dr, v => upd({ dr: v || 0 })),
      h('label', 'Ecos'), (() => { const i = h('input', { value: d.ecos || '', 'data-key': 'ecos' }); i.addEventListener('change', () => upd({ ecos: i.value })); return i; })(),
      h('label', 'Fraquezas'), listInput('weaknesses', d.weaknesses),
      h('label', 'Resistências'), listInput('resistances', d.resistances));

    const toggles = h('div.row.small',
      toggle('Jogadores veem a barra de Vida', d.showBars, v => upd({ showBars: v })),
      toggle('Números ocultos (Desconhecido)', d.hideStats, v => upd({ hideStats: v })),
      toggle('Sem ataques de oportunidade', d.noOpportunity, v => upd({ noOpportunity: v })));

    const attacks = h('div');
    (d.attacks || []).forEach((atk, i) => attacks.append(h('div.list-row',
      h('div.grow', h('b', atk.name), h('span.small.muted', ` ${atk.pa ?? 2} PA · ${damageText(atk.damage)}${atk.trick ? ` + ${damageText(atk.trick)} (truque)` : ''}${atk.range ? ` · alcance ${atk.range} m` : ''}${atk.area ? ' · área' : ''}`),
        atk.applyStates?.length ? h('div.small', `Aplica: ${atk.applyStates.map(s => `${s.state}${s.minExcess ? ` (${s.minExcess}+ excedentes)` : ''}`).join(', ')}`) : null,
        atk.text ? h('div.small.muted', atk.text) : null),
      h('button.small.primary', { onclick: () => creatureAttackDialog(a, i) }, '⚔ Atacar'),
      h('button.small.ghost', { title: 'Editar', onclick: () => editAttack(a, i) }, '✎'),
      h('button.small.ghost', { title: 'Remover', onclick: () => upd({ attacks: d.attacks.filter((_, j) => j !== i) }) }, '✕'))));
    attacks.append(h('button.small', { onclick: () => editAttack(a, -1) }, '+ Ataque'));

    const abilities = h('div', ...(d.abilities || []).map(ab => h('div.list-row', h('div.grow', h('b', ab.name), ab.pa ? h('span.small.muted', ` ${ab.pa} PA`) : null, h('div.small', ab.text)))));
    const phases = (d.phases || []).length ? h('div',
      ...(d.phases || []).map(p => h('div.small', { style: { opacity: p.phase === d.phase ? 1 : 0.6 } }, h('b', `${p.name}${p.phase === d.phase ? ' (atual)' : ''}: `), p.text)),
      h('button.small', { onclick: () => act('phase', { actorId: a.id }) }, '▲ Avançar Fase (Postura Elevada)')) : h('button.small', { onclick: () => act('phase', { actorId: a.id }) }, '▲ Postura Elevada (+1 Limiar por 2 turnos)');

    const stateSel = h('select.small', ...R().states.states.map(s => h('option', { value: s.id }, `${s.icon || ''} ${s.name}`)));
    const rounds = h('input.small', { type: 'number', placeholder: 'turnos', style: { width: '70px' } });
    const notes = h('textarea', { rows: 4, 'data-key': 'notes' }, d.notes || '');
    notes.addEventListener('change', () => upd({ notes: notes.value }));

    win.setContent([
      h('div.sheet-header', portrait, h('div.grow.col', name, h('div.row', tierSel, h('span.small.muted', d.category || ''), d.unknown ? h('span.tag.danger', 'Ascendente — Desconhecido') : null),
        d.quote ? h('div.small', { style: { fontStyle: 'italic' } }, `“${d.quote}”`) : null)),
      h('div.section-title', 'Números'), stats, toggles,
      h('div.row', { style: { marginTop: '6px' } },
        h('button.small', { onclick: () => act('creatureRoll', { actorId: a.id }) }, `🎲 Rolar ${dv.dice ?? '?'} dados`),
        h('button.small', { onclick: () => act('adjust', { actorIds: [a.id], amount: d.hp?.max || 0, mode: 'heal' }) }, 'Vida cheia')),
      h('div.section-title', 'Estados'),
      h('div.chips', ...(d.states.length ? d.states.map(s => stateChip(s, { onRemove: () => act('state', { actorId: a.id, state: s.id, remove: true }) })) : [h('span.muted.small', 'Nenhum')])),
      h('div.row.small', stateSel, rounds, h('button.small', { onclick: () => act('state', { actorId: a.id, state: stateSel.value, rounds: rounds.value }) }, '+ Estado')),
      h('div.section-title', 'Ataques'), attacks,
      (d.abilities || []).length ? h('div.section-title', 'Habilidades') : null, abilities,
      h('div.section-title', 'Fases de Chefe'), phases,
      h('div.section-title', 'Notas do Mestre'), notes,
      d.text ? h('p.small.muted', d.text) : null
    ]);
    win.body.scrollTop = scroll;
    if (focused) win.body.querySelector(`[data-key="${focused}"]`)?.focus();
  }

  function toggle(label, value, onChange) {
    const cb = h('input', { type: 'checkbox', checked: !!value });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label.row', cb, label);
  }

  async function editAttack(a, index) {
    const atk = index >= 0 ? a.data.attacks[index] : { name: 'Ataque', pa: 2, damage: [{ dice: '1d6', type: 'Contusio' }] };
    const types = R()['damage-types'].types;
    const r = await app.ui.formDialog(index >= 0 ? 'Editar ataque' : 'Novo ataque', [
      { name: 'name', label: 'Nome', value: atk.name },
      { name: 'pa', label: 'Custo (PA)', type: 'number', value: atk.pa ?? 2 },
      { name: 'damage', label: 'Dano (ex.: 2d6 Ignis + 1d4 Contusio)', value: (atk.damage || []).map(p => `${p.dice} ${p.type}`).join(' + ') },
      { name: 'trick', label: 'Dano fixo não multiplicável (opcional)', value: (atk.trick || []).map(p => `${p.dice} ${p.type}`).join(' + ') },
      { name: 'range', label: 'Alcance (m)', type: 'number', value: atk.range ?? '' },
      { name: 'area', label: 'Ataque em área (rola uma vez)', type: 'checkbox', value: !!atk.area },
      { name: 'state', label: 'Aplica estado ao acertar', type: 'select', value: atk.applyStates?.[0]?.state || '', options: [{ value: '', label: '—' }, ...R().states.states.map(s => ({ value: s.id, label: s.name }))] },
      { name: 'minExcess', label: '…com excedentes mínimos', type: 'number', value: atk.applyStates?.[0]?.minExcess ?? 0 },
      { name: 'text', label: 'Observação', value: atk.text || '' }
    ], { width: 480 });
    if (!r) return;
    const parse = (s) => String(s || '').split('+').map(x => x.trim()).filter(Boolean).map(x => {
      const [dice, ...rest] = x.split(/\s+/);
      const t = rest.join(' ');
      return { dice, type: types.find(tt => tt.id.toLowerCase() === t.toLowerCase())?.id || t || 'Contusio' };
    });
    const next = { name: r.name, pa: r.pa ?? 2, damage: parse(r.damage), ...(r.trick ? { trick: parse(r.trick) } : {}), ...(r.range ? { range: r.range } : {}), ...(r.area ? { area: true } : {}),
      ...(r.state ? { applyStates: [{ state: r.state, minExcess: r.minExcess || 0 }] } : {}), ...(r.text ? { text: r.text } : {}) };
    const list = [...(a.data.attacks || [])];
    if (index >= 0) list[index] = next; else list.push(next);
    upd({ attacks: list });
  }

  function publicView(a) {
    const d = a.data;
    return h('div', h('div.sheet-header', h('div.portrait', a.img ? h('img', { src: a.img, alt: '' }) : h('span', '?')), h('div.col', h('h2', a.name),
      h('div.muted', d.unknown ? 'Limiar: Desconhecido · Dados: Desconhecido · Vida: Desconhecida' : (d.hp ? `Vida ${d.hp.value}/${d.hp.max}` : 'Números desconhecidos')))),
      d.states?.length ? h('div.chips', ...d.states.map(s => stateChip(s))) : null);
  }

  const off = app.on(`actor:${actorId}`, render);
  const oldClose = win.close;
  win.close = () => { off(); oldClose(); };
  render();
}
