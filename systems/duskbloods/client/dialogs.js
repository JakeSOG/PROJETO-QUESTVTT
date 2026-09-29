// Diálogos de ação: ataque (com TOC), ataque de criatura, Arcanos, Marcas e criação de ficha.
import { ctx, h, R, IDX, act, isGM, call, damageText, classDef, tierDef } from './util.js';

// Seletor de alvos: usa os alvos marcados (T) ou permite marcar aqui.
function targetPicker(onChange) {
  const st = ctx.app.state;
  const box = h('div.col');
  const render = () => {
    box.replaceChildren();
    const tokens = st.scene ? [...st.scene.tokens.values()].filter(t => t.actor_id && t.data.disposition !== 'corpse') : [];
    if (!tokens.length) { box.append(h('div.muted.small', 'Nenhum token na cena.')); return; }
    for (const t of tokens) {
      const cb = h('input', { type: 'checkbox', checked: st.targets.has(t.id) });
      cb.addEventListener('change', () => {
        if (cb.checked) st.targets.add(t.id); else st.targets.delete(t.id);
        ctx.app.emit('targets');
        onChange && onChange();
      });
      box.append(h('label.row.small', cb, t.data.name || '?', t.data.hidden ? ' (oculto)' : ''));
    }
  };
  render();
  return box;
}

function footer(win, label, onOk) {
  win.setFooter([h('button', { onclick: () => win.close() }, 'Cancelar'), h('button.primary', { onclick: async () => { const r = await onOk(); if (!r || !r.error) win.close(); } }, label)]);
}

// ---------------- Ataque do caçador ----------------
export function attackDialog(actor, preset = {}) {
  const d = actor.data;
  const rc = R().combat;
  const opts = [];
  const main = d.weapons.find(w => w.uid === d.equip.main);
  for (const w of d.weapons) {
    const ref = IDX().weapons[w.ref];
    if (!ref) continue;
    opts.push({ value: w.uid, label: `${ref.name} — ${ref.forms[w.form].name}${w.uid === d.equip.main ? ' (empunhada)' : ''}`, kind: 'weapon', w, ref });
  }
  for (const r of d.revolvers) {
    const ref = IDX().revolvers[r.ref];
    if (ref) opts.push({ value: r.uid, label: `${ref.name} (${r.ammo ?? 0}/${ref.ammoCapacity})`, kind: 'revolver', r, ref });
  }
  for (const m of d.mutations || []) {
    const ref = IDX().mutations[m];
    if (ref?.attack) opts.push({ value: `mutation:${m}`, label: `${ref.attack.name} (mutação)`, kind: 'mutation', ref });
  }
  opts.push({ value: 'unarmed', label: 'Desarmado', kind: 'unarmed' });

  const weapon = h('select', ...opts.map(o => h('option', { value: o.value, selected: o.value === (preset.weapon || d.equip.main) }, o.label)));
  const mode = h('select',
    h('option', { value: 'basic', selected: preset.mode === 'basic' || !preset.mode }, 'Ataque Básico'),
    h('option', { value: 'heavy', selected: preset.mode === 'heavy' }, `Ataque Pesado (+${rc.attacks.heavyExtraPa} PA, +${rc.attacks.heavyFixedDamage} dano, desestabiliza)`),
    h('option', { value: 'visceral', selected: preset.mode === 'visceral' }, 'Ataque Visceral (alvo em Fractura: sempre acerta)'),
    h('option', { value: 'abate', selected: preset.mode === 'abate' }, 'Tiro de Abate (fora de combate, alvo desprevenido)'));
  const trigger = h('input', { type: 'checkbox', checked: !!preset.trigger });
  const stealth = h('input', { type: 'checkbox' });
  const cover = h('select', ...rc.cover.map(c => h('option', { value: c.bonus }, `${c.name}${c.bonus ? ` (+${c.bonus})` : ''}`)));
  const bonus = h('input', { type: 'number', value: 0, min: -10, max: 10 });
  const info = h('div.small.muted');

  const update = () => {
    const o = opts.find(x => x.value === weapon.value);
    let cost = 0;
    let txt = '';
    if (o?.kind === 'weapon') {
      const form = o.ref.forms[trigger.checked ? (o.w.form === 'padrao' ? 'truque' : 'padrao') : o.w.form];
      const cat = form.category === 'disparo' ? 'agil' : form.category;
      cost = rc.attacks.basic[cat] + (mode.value === 'heavy' ? rc.attacks.heavyExtraPa : 0) + (trigger.checked ? rc.attacks.triggerCost : 0);
      txt = `Forma: <b>${form.name}</b> (${form.category === 'agil' ? 'Ágil' : form.category === 'pesada' ? 'Pesada' : 'Disparo'}, ${form.hands === 2 ? 'Duas Mãos' : 'Uma Mão'}) · ${damageText(form.damage)}${form.trick ? ` + <b>${damageText(form.trick)} de Truque</b> (não multiplica)` : ''}`;
      if (trigger.checked && form.hands === 2 && d.equip.off && !d.equip.offStowed) txt += '<br>⚠ Duas Mãos: o item da mão livre será guardado.';
    } else if (o?.kind === 'revolver') { cost = o.ref.pa; txt = `${damageText(o.ref.damage)} · ${o.ref.text || ''}`; }
    else if (o?.kind === 'unarmed') { cost = rc.attacks.unarmed.pa; txt = 'Agilidade + Armas Ágeis · 1d4 Contusio'; }
    else if (o?.kind === 'mutation') { cost = o.ref.attack.pa; txt = damageText(o.ref.attack.damage); }
    if (mode.value === 'visceral') { cost = stealth.checked ? rc.visceral.costStealth : rc.visceral.costFracture; txt += '<br>Dano da arma dobrado, Massivo. Truque, Reforço e revestimentos não dobram.'; }
    info.innerHTML = `${txt}<br>Custo estimado: <b>${cost} PA</b> (você tem ${d.pa?.value ?? 0}).`;
    trigger.disabled = o?.kind !== 'weapon' || mode.value !== 'basic';
    if (trigger.disabled) trigger.checked = false;
  };
  [weapon, mode, trigger, stealth].forEach(x => x.addEventListener('change', update));

  const win = ctx.app.ui.openWindow({ id: `attack-${actor.id}`, title: `Ataque — ${actor.name}`, width: 460 });
  win.setContent([
    h('div.form-grid',
      h('label', 'Arma'), weapon,
      h('label', 'Tipo'), mode,
      h('label', 'Gatilho da Oficina'), h('label.row', trigger, 'Transformar a arma junto do ataque (+1 PA)'),
      h('label', 'Furtivo'), h('label.row', stealth, 'Alvo desprevenido / estou sob Latens'),
      h('label', 'Cobertura do alvo'), cover,
      h('label', 'Dados extras'), bonus),
    h('div.card-block', info),
    h('div.group-title', 'Alvos'),
    targetPicker(update)
  ]);
  update();
  footer(win, '⚔ Atacar', () => act('attack', {
    actorId: actor.id, weapon: weapon.value, mode: mode.value, trigger: trigger.checked, stealth: stealth.checked,
    cover: Number(cover.value), bonusDice: Number(bonus.value) || 0, targets: [...ctx.app.state.targets]
  }));
}

// ---------------- Ataque de criatura (Mestre) ----------------
export function creatureAttackDialog(actor, attackIndex = 0) {
  const d = actor.data;
  const atk = h('select', ...(d.attacks || []).map((a, i) => h('option', { value: i, selected: i === attackIndex }, `${a.name} — ${damageText(a.damage)}${a.trick ? ` + ${damageText(a.trick)}` : ''} (${a.pa ?? 2} PA)`)));
  const heavy = h('input', { type: 'checkbox' });
  const opp = h('input', { type: 'checkbox' });
  const cover = h('select', ...R().combat.cover.map(c => h('option', { value: c.bonus }, `${c.name}${c.bonus ? ` (+${c.bonus})` : ''}`)));
  const bonus = h('input', { type: 'number', value: 0 });
  const win = ctx.app.ui.openWindow({ id: `cattack-${actor.id}`, title: `Ataque — ${actor.name}`, width: 440 });
  win.setContent([
    h('div.form-grid',
      h('label', 'Ataque'), atk,
      h('label', 'Pesado'), h('label.row', heavy, `+${R().combat.attacks.heavyFixedDamage} dano, -2 Guarda, desestabiliza`),
      h('label', 'Oportunidade'), h('label.row', opp, 'Ataque de oportunidade (sem custo)'),
      h('label', 'Cobertura do alvo'), cover,
      h('label', 'Dados extras'), bonus),
    h('p.small.muted', `PA: ${d.pa?.value ?? '?'}/${d.pa?.max ?? '?'}. O alvo com revólver em mãos e PA guardado recebe a oferta de Contra-Tiro antes da rolagem.`),
    h('div.group-title', 'Alvos'),
    targetPicker()
  ]);
  footer(win, '⚔ Atacar', () => act('creatureAttack', {
    actorId: actor.id, attackIndex: Number(atk.value), heavy: heavy.checked, opportunity: opp.checked,
    cover: Number(cover.value), bonusDice: Number(bonus.value) || 0, targets: [...ctx.app.state.targets]
  }));
}

// ---------------- Arcanos ----------------
export function castDialog(actor, arcaneId) {
  const d = actor.data;
  const list = (d.arcana.prepared || []).map(id => IDX().arcana[id]).filter(Boolean);
  if (!list.length && !isGM()) { ctx.app.ui.toast('Nenhum Arcano preparado.', 'error'); return; }
  const all = isGM() && !list.length ? (d.arcana.known || []).map(id => IDX().arcana[id]).filter(Boolean) : list;
  const sel = h('select', ...all.map(a => h('option', { value: a.id, selected: a.id === arcaneId }, `${a.name} (${a.pa} PA)`)));
  const info = h('div.small');
  const bonus = h('input', { type: 'number', value: 0 });
  const reserve = h('input', { type: 'checkbox' });
  const update = () => {
    const a = IDX().arcana[sel.value];
    if (!a) return;
    const cd = d.arcana.cooldowns?.[a.id];
    const costs = [`${a.pa} PA`];
    if (a.costs?.flasks) costs.push(`${a.costs.flasks} Frasco(s)`);
    if (a.costs?.hp) costs.push(`${a.costs.hp} Vida própria`);
    if (a.costs?.dementia) costs.push(`${a.costs.dementia} Dementia`);
    if (a.costs?.selfDamage) costs.push(`${a.costs.selfDamage.dice} ${a.costs.selfDamage.type} em si`);
    info.innerHTML = `<b>${a.name}</b> · ${costs.join(' + ')}${a.noCooldown ? ' · sem recarga' : ' · recarga 3 turnos'}${cd ? ` · <span class="danger">disponível na rodada ${cd}</span>` : ''}<br><i>${a.text}</i>`;
  };
  sel.addEventListener('change', update);
  const win = ctx.app.ui.openWindow({ id: `cast-${actor.id}`, title: `Arcano — ${actor.name}`, width: 460 });
  const cls = classDef(d.class);
  win.setContent([
    h('div.form-grid', h('label', 'Arcano'), sel, h('label', 'Dados extras'), bonus,
      cls?.id === 'arcanivagus' ? h('label', 'Reserva Arcana') : null, cls?.id === 'arcanivagus' ? h('label.row', reserve, 'Conjurar sem Canalizador (+PA)') : null),
    h('div.card-block', info),
    h('div.group-title', 'Alvos (vazio = você mesmo, para Arcanos de toque)'),
    targetPicker()
  ]);
  update();
  footer(win, '✦ Conjurar', () => act('cast', { actorId: actor.id, arcaneId: sel.value, bonusDice: Number(bonus.value) || 0, useReserve: reserve.checked, targets: [...ctx.app.state.targets] }));
}

// ---------------- Marcas do Caçador ----------------
export function markDialog(actor, markId) {
  const d = actor.data;
  const list = (d.marks || []).map(id => IDX().marks[id]).filter(Boolean);
  if (!list.length) { ctx.app.ui.toast('Nenhuma Marca aprendida.', 'error'); return; }
  const qty = (mat) => (d.inventory || []).filter(i => i.ref === mat).reduce((a, i) => a + i.qty, 0);
  const sel = h('select', ...list.map(m => h('option', { value: m.id, selected: m.id === markId }, `${m.name} — ${IDX().items[m.material]?.name || m.material}: ${qty(m.material)}`)));
  const info = h('div.small');
  const bonus = h('input', { type: 'number', value: 0 });
  const update = () => { const m = IDX().marks[sel.value]; info.innerHTML = `<b>${m.name}</b> · ${m.pa} PA · material: ${IDX().items[m.material]?.name || m.material} (${qty(m.material)})<br><i>${m.text}</i>`; };
  sel.addEventListener('change', update);
  const win = ctx.app.ui.openWindow({ id: `mark-${actor.id}`, title: `Marca do Caçador — ${actor.name}`, width: 460 });
  win.setContent([h('div.form-grid', h('label', 'Marca'), sel, h('label', 'Dados extras'), bonus), h('div.card-block', info), h('div.group-title', 'Alvos'), targetPicker()]);
  update();
  footer(win, 'Usar', () => act('mark', { actorId: actor.id, markId: sel.value, bonusDice: Number(bonus.value) || 0, targets: [...ctx.app.state.targets] }));
}

// ---------------- Criação de ficha ----------------
export async function createActorDialog(type) {
  const ui = ctx.app.ui;
  const st = ctx.app.state;
  if (type === 'hunter') {
    const players = st.users.filter(u => u.role === 'player');
    const r = await ui.formDialog('Novo caçador', [
      { name: 'name', label: 'Nome', value: '' },
      { name: 'class', label: 'Classe', type: 'select', value: 'cruentaris', options: R().classes.classes.map(c => ({ value: c.id, label: `${c.name} — ${c.title}` })) },
      { name: 'weapon', label: 'Arma Básica', type: 'select', value: 'lamina-simples', options: R().between.startingKit.basicWeapons.map(id => ({ value: id, label: IDX().weapons[id]?.name || id })) },
      { name: 'off', label: 'Mão livre', type: 'select', value: 'revolver', options: [{ value: 'revolver', label: 'Revólver de Caçador (Contra-Tiro)' }, { value: 'channeler', label: 'Canalizador de Iniciado (Arcanos)' }] },
      ...(isGM() ? [{ name: 'ownerId', label: 'Jogador', type: 'select', value: '', options: [{ value: '', label: '— nenhum —' }, ...players.map(p => ({ value: p.id, label: p.name }))] }] : [])
    ], { okLabel: 'Criar', intro: 'Kit inicial da Oficina: Arma Básica, revólver (com 10 balas) ou Canalizador, Pingente, 3 Frascos de Sangue e nenhum Eco. Distribua 10 pontos de atributo na ficha.' });
    if (!r) return;
    const res = await call('actor:create', { type, name: r.name || 'Novo Caçador', ownerId: r.ownerId || null, data: { class: r.class, kit: { weapon: r.weapon, off: r.off } } });
    if (res.actor) ctx.app.system.openSheet(res.actor);
    return;
  }
  const r = await ui.formDialog('Nova criatura', [
    { name: 'name', label: 'Nome', value: '' },
    { name: 'tier', label: 'Ameaça', type: 'select', value: 'padrao', options: R().combat.creatureTiers.map(t => ({ value: t.id, label: `${t.name} (Limiar ${t.limiar}, ${t.pa} PA)` })) }
  ], { okLabel: 'Criar' });
  if (!r) return;
  const tier = tierDef(r.tier);
  const res = await call('actor:create', { type, name: r.name || 'Criatura', data: { tier: r.tier, limiar: tier.limiar, dice: tier.dice[0], pa: { value: tier.pa, max: tier.pa } } });
  if (res.actor) ctx.app.system.openSheet(res.actor);
}
