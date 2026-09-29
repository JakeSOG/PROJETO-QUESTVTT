// Ficha do Caçador. Lê tudo das regras (JSON). Cliques em atributos/perícias rolam direto.
import { ctx, h, R, IDX, act, isGM, call, uid, esc, attrName, skillName, stateDef, classDef, stateChip, damageText } from './util.js';
import { attackDialog, castDialog, markDialog } from './dialogs.js';
import { addToActor } from './compendium.js';

const TABS = [
  ['cacador', 'Caçador'], ['combate', 'Combate'], ['arsenal', 'Arsenal'], ['arcano', 'Arcanos & Marcas'],
  ['inventario', 'Inventário'], ['progressao', 'Progressão'], ['notas', 'Notas']
];

export function openHunterSheet(actorId) {
  const app = ctx.app;
  const winId = `sheet-${actorId}`;
  if (app.ui.getWindow(winId)) { app.ui.getWindow(winId).focus(); return; }
  let tab = localStorage.getItem('qvtt.sheetTab') || 'cacador';
  const win = app.ui.openWindow({ id: winId, title: '', width: 830, height: 720, className: 'sheet-window' });

  const actor = () => app.state.actors.get(actorId);
  const upd = (data) => call('actor:update', { id: actorId, data });
  const editable = () => { const a = actor(); return a && a.full && (isGM() || a.owner_id === app.state.user.id); };

  function render() {
    const a = actor();
    if (!a) { win.close(); return; }
    // Preserva foco e rolagem ao redesenhar
    const focused = document.activeElement?.dataset?.key;
    const scroll = win.body.scrollTop;
    win.setTitle(a.name);
    if (!a.full) { win.setContent(publicView(a)); return; }
    const d = a.data, dv = a.derived;
    const tabs = h('div.sheet-tabs', ...TABS.map(([id, label]) => h('button', { class: tab === id ? 'active' : '', onclick: () => { tab = id; try { localStorage.setItem('qvtt.sheetTab', id); } catch { /* ok */ } render(); } }, label)));
    const content = { cacador, combate, arsenal, arcano, inventario, progressao, notas }[tab](a, d, dv);
    win.setContent([header(a, d, dv), tabs, h('div.sheet-body', content)]);
    win.body.scrollTop = scroll;
    if (focused) { const el = win.body.querySelector(`[data-key="${focused}"]`); if (el) { el.focus(); if (el.select && el.type !== 'number') { /* mantém cursor */ } } }
  }

  // ---------------- Cabeçalho ----------------
  function header(a, d, dv) {
    const cls = classDef(d.class);
    const portrait = h('div.portrait', { title: editable() ? 'Clique para trocar o retrato' : '' }, a.img ? h('img', { src: a.img, alt: a.name }) : h('span', a.name.slice(0, 2).toUpperCase()));
    if (editable()) portrait.addEventListener('click', async () => {
      const f = await app.ui.pickFile('image/*');
      if (!f) return;
      const url = await app.upload('portrait', f);
      if (url) call('actor:update', { id: a.id, img: url });
    });
    const name = h('input.sheet-name', { value: a.name, 'data-key': 'name', disabled: !editable() });
    name.addEventListener('change', () => call('actor:update', { id: a.id, name: name.value }));
    const clsSel = h('select', { 'data-key': 'class', disabled: !editable() }, ...R().classes.classes.map(c => h('option', { value: c.id, selected: c.id === d.class }, `${c.name} — ${c.title}`)));
    clsSel.addEventListener('change', () => upd({ class: clsSel.value, classSkill: classDef(clsSel.value).classSkills[0] }));
    const pending = pendingMutations(d);
    return h('div.sheet-header',
      portrait,
      h('div.grow.col',
        name,
        h('div.row', clsSel, cls.classSkills.length > 1 ? classSkillSelect(d, cls) : h('span.small.muted', `Perícia de classe: ${skillName(cls.classSkills[0])}`)),
        h('div.row.small',
          badge('Discernimento', `${d.discernment} · ${dv.discernmentStage.name}`),
          badge('Dementia', `${d.dementia}/${R().dementia.max} · ${dv.dementiaStage.name}`, d.dementia >= 24 ? 'danger' : ''),
          badge('Humanitas', `${d.humanitas > 0 ? '+' : ''}${d.humanitas} · ${dv.humanitasBand.name}`)),
        pending.length ? h('div.small.danger', `🩸 Escolha uma mutação: ${pending.join(', ')} (aba Progressão)`) : null,
        d.dying ? h('div.small.danger', `🕯 MORRENDO — velas acesas ${d.dying.lit}, apagadas ${d.dying.out}${d.dying.stable ? ' (estabilizado)' : ''}`) : null));
  }

  function classSkillSelect(d, cls) {
    const s = h('select.small', { disabled: !editable() }, ...cls.classSkills.map(id => h('option', { value: id, selected: id === d.classSkill }, `Perícia de classe: ${skillName(id)}`)));
    s.addEventListener('change', () => upd({ classSkill: s.value }));
    return s;
  }

  const badge = (label, value, cls = '') => h('span.sheet-badge', { class: `sheet-badge ${cls}` }, h('span.muted', label), ' ', h('b', value));

  function pendingMutations(d) {
    const grades = d.mutationGrades || [];
    const have = (d.mutations || []).map(m => IDX().mutations[m]?.grade);
    return grades.filter(g => !have.includes(g)).map(g => R().dementia.mutationGrades.find(x => x.id === g)?.name || g);
  }

  // ---------------- Aba Caçador ----------------
  function cacador(a, d, dv) {
    const tracks = h('div.tracks',
      track('Vida', d.hp.value, dv.hpMax, 'hp', 'blood'),
      track('Guarda', d.guard.value, dv.guardMax, 'guard', 'bronze'),
      track('PA', d.pa.value, dv.paMax, 'pa', 'pa', !isGM()),
      statBox('Limiar', dv.limiar, dv.limiarBreakdown.join('<br>')),
      counter('Frascos de Sangue', d.flasks, 'flasks', h('button.small', { onclick: () => act('flask', { actorId: a.id }) }, 'Beber')),
      counter('Ecos de Sangue', d.ecos, 'ecos'),
      counter('Discernimento', d.discernment, 'discernment', null, !isGM()),
      counter('Dementia', d.dementia, 'dementia', null, !isGM()),
      counter('Humanitas', d.humanitas, 'humanitas', null, !isGM()));

    const attrs = h('div.attr-grid');
    const pointsUsed = R().attributes.attributes.reduce((s, x) => s + (d.attributes[x.id] || 0) - R().attributes.creation.attributeBase, 0);
    for (const at of R().attributes.attributes) {
      const col = h('div.attr-col');
      const val = h('input', { type: 'number', value: d.attributes[at.id], min: 0, max: 20, 'data-key': `attr-${at.id}`, disabled: !editable() });
      val.addEventListener('change', () => upd({ attributes: { [at.id]: Number(val.value) } }));
      const title = h('button.attr-name', { title: `Rolar só ${at.name} (${dv.attributes[at.id]}D6)`, onclick: () => test(a, at.id, null) }, at.name);
      col.append(h('div.attr-head', title, val, dv.attributes[at.id] !== d.attributes[at.id] ? h('span.small.gold', `(${dv.attributes[at.id]})`) : null));
      for (const sk of R().attributes.skills.filter(s => s.attribute === at.id)) {
        const lvl = d.skills[sk.id] || 0;
        const pips = h('span.pips');
        for (let i = 1; i <= R().attributes.proficiency.max; i++) {
          const pip = h('button.pip', { class: `pip ${i <= lvl ? 'on' : ''}`, title: `Proficiência ${R().attributes.proficiency.labels[i]}`, disabled: !editable(), onclick: () => upd({ skills: { [sk.id]: lvl === i ? i - 1 : i } }) });
          pips.append(pip);
        }
        const pool = (dv.attributes[at.id] || 0) + (dv.skills[sk.id] || 0);
        const row = h('div.skill-row', { class: `skill-row ${sk.id === d.classSkill ? 'class-skill' : ''}` },
          h('button.skill-name', { onclick: () => test(a, at.id, sk.id) }, sk.name), pips, h('span.pool', `${pool}D6`));
        app.ui.tooltip(row, `<b>${esc(sk.name)}</b> (${esc(at.name)})<br>${esc(sk.text)}${sk.id === d.classSkill ? '<br><i>Perícia de classe</i>' : ''}`);
        col.append(row);
      }
      attrs.append(col);
    }
    const creation = R().attributes.creation;
    const diff = h('select.small', ...R().core.difficulties.map(x => h('option', { value: x.successes, selected: x.successes === 2 }, `${x.name} (${x.successes})`)), h('option', { value: '' }, 'sem dificuldade'));
    diff.dataset.key = 'difficulty';
    diff.value = localStorage.getItem('qvtt.dif') ?? '2';
    diff.addEventListener('change', () => { try { localStorage.setItem('qvtt.dif', diff.value); } catch { /* ok */ } });
    const sanDiff = h('select.small', ...R().dementia.sanityDifficulties.map(x => h('option', { value: x.successes }, `${x.name} (${x.successes})`)));
    const cls = classDef(d.class);
    return h('div',
      tracks,
      h('div.row', { style: { margin: '8px 0' } },
        h('span.small.muted', 'Dificuldade ao clicar:'), diff,
        h('span.right.small.muted', `Pontos de atributo usados: ${pointsUsed}/${creation.attributePoints} (máx. ${creation.attributeMaxAtCreation} na criação)`)),
      attrs,
      h('div.row', { style: { marginTop: '10px' } },
        h('button', { onclick: () => act('sanity', { actorId: a.id, difficulty: Number(sanDiff.value) }) }, '🧠 Teste de Sanidade'), sanDiff,
        dv.sanityDice ? h('span.small.muted', `+${dv.sanityDice} dado(s) de Resistência a Dementia`) : null),
      h('div.passive', h('b', `${cls.passive.name}: `), cls.passive.text),
      d.states.length ? h('div.chips', ...d.states.map(s => stateChip(s))) : null);

    function test(actorObj, attribute, skill) {
      const dif = diff.value === '' ? null : Number(diff.value);
      act('test', { actorId: actorObj.id, attribute, skill, difficulty: dif });
    }
  }

  function track(label, value, max, key, cls, readonly = !editable()) {
    const input = h('input', { type: 'number', value: value ?? 0, 'data-key': key, disabled: readonly });
    input.addEventListener('change', () => upd({ [key]: { value: Number(input.value) } }));
    const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return h('div.track', { class: `track ${cls}` }, h('div.track-label', label), h('div.track-val', input, h('span', `/ ${max}`)), h('div.track-bar', h('div', { style: { width: `${pct}%` } })));
  }
  function statBox(label, value, tip) {
    const el = h('div.track.stat', h('div.track-label', label), h('div.track-big', String(value)));
    if (tip) app.ui.tooltip(el, tip);
    return el;
  }
  function counter(label, value, key, extra = null, readonly = !editable()) {
    const input = h('input', { type: 'number', value: value ?? 0, 'data-key': key, disabled: readonly });
    input.addEventListener('change', () => upd({ [key]: Number(input.value) }));
    return h('div.track.stat', h('div.track-label', label), h('div.track-val', input, extra));
  }

  // ---------------- Aba Combate ----------------
  function combate(a, d, dv) {
    const rc = R().combat;
    const out = h('div');
    // Estados
    const addState = isGM() ? stateAdder(a) : null;
    out.append(h('div.section-title', 'Estados'), h('div.chips', ...(d.states.length ? d.states.map(s => stateChip(s, { onRemove: isGM() ? () => act('state', { actorId: a.id, state: s.id, remove: true }) : null })) : [h('span.muted.small', 'Nenhum estado ativo.')])), addState);
    // Morrendo
    if (d.dying) {
      out.append(h('div.dying-box',
        h('div', h('b', 'À beira do Sonho'), ` — acesas ${d.dying.lit}/3, apagadas ${d.dying.out}/3${d.dying.stable ? ' · estabilizado' : ''}`),
        h('div.row',
          !d.dying.stable ? h('button.small', { onclick: () => act('candles', { actorId: a.id }) }, '🕯 Rolar velas (Vigor + Resiliência)') : null,
          !d.dying.parasiteUsed && d.dying.out > 0 ? h('button.small', { onclick: () => act('parasite', { actorId: a.id }) }, 'Deixar o parasita segurar (+2 Dementia)') : null,
          isGM() ? h('button.small.primary', { onclick: () => act('death', { actorId: a.id }) }, '☠ Morte (desperta no Sonho)') : null)));
    }
    // Defesas
    const def = h('div.row', ...rc.defenses.map(x => {
      const bonus = dv.mods?.defenseBonus?.[x.id] ?? x.bonus;
      return h('button', { class: d.defense?.id === x.id ? 'active' : '', title: `${x.pa} PA · +${bonus} Limiar${x.consumesGuard ? ' · consome Guarda se segurar o golpe' : ' · nunca consome Guarda'}`, onclick: () => act('defend', { actorId: a.id, defense: x.id }) }, `${x.name} (${x.pa})`);
    }));
    out.append(h('div.section-title', `Defesa — Limiar ${dv.limiar}`), def, d.defense ? h('div.small.gold', `Ativo: ${d.defense.name} (+${d.defense.bonus}) até o início do seu próximo turno.`) : null);

    // Mãos
    const main = d.weapons.find(w => w.uid === d.equip.main);
    const mainRef = main && IDX().weapons[main.ref];
    const off = d.equip.off ? [...d.revolvers, ...d.channelers].find(x => x.uid === d.equip.off) : null;
    const offRef = off ? (IDX().revolvers[off.ref] || IDX().channelers[off.ref]) : null;
    out.append(h('div.section-title', 'Em mãos'));
    if (mainRef) {
      const form = mainRef.forms[main.form];
      const other = mainRef.forms[main.form === 'padrao' ? 'truque' : 'padrao'];
      out.append(h('div.weapon-card',
        h('div.row', h('b', mainRef.name), h('span.tag', main.form === 'padrao' ? 'Forma Padrão' : 'Forma de Truque'), h('span.small.muted', `${form.name} · ${form.category === 'agil' ? 'Ágil' : form.category === 'pesada' ? 'Pesada' : 'Disparo'} · ${form.hands === 2 ? 'Duas Mãos' : 'Uma Mão'}`), d.equip.mainStowed ? h('span.tag.danger', 'guardada') : null),
        h('div.small', `Dano: ${damageText(form.damage)}${form.trick ? ` + ${damageText(form.trick)} (Truque)` : ''}${main.reforco ? ` + Reforço ${main.reforco}` : ''}${form.ranged ? ` · munição ${main.ammo ?? 0}/${form.ammoCapacity}` : ''}`),
        form.text ? h('div.small.muted', form.text) : null,
        main.coating ? h('div.small.gold', `Revestimento: ${main.coating.name} (+${main.coating.dice} ${main.coating.type}, ${main.coating.rounds} turnos)`) : null,
        h('div.row',
          h('button.primary', { onclick: () => attackDialog(a, { weapon: main.uid, mode: 'basic' }) }, '⚔ Atacar'),
          h('button', { title: `Gatilho da Oficina: troca para ${other.name} junto do ataque (+1 PA)`, onclick: () => attackDialog(a, { weapon: main.uid, mode: 'basic', trigger: true }) }, `⚙ Gatilho → ${other.name}`),
          form.category !== 'disparo' ? h('button', { onclick: () => attackDialog(a, { weapon: main.uid, mode: 'heavy' }) }, 'Pesado') : null,
          h('button', { onclick: () => attackDialog(a, { weapon: main.uid, mode: 'visceral' }) }, 'Visceral'),
          h('button', { title: 'Fora de combate a troca é livre', onclick: () => act('hands', { actorId: a.id, op: 'transform', uid: main.uid }) }, 'Transformar'),
          d.equip.mainStowed ? h('button', { onclick: () => act('hands', { actorId: a.id, op: 'drawMain' }) }, 'Sacar (1 PA)') : null,
          form.ranged ? h('button', { onclick: () => act('hands', { actorId: a.id, op: 'reload', uid: main.uid }) }, 'Recarregar') : null)));
    } else out.append(h('p.muted.small', 'Nenhuma arma empunhada (aba Arsenal).'));
    if (offRef) {
      const isRev = !!IDX().revolvers[off.ref];
      out.append(h('div.weapon-card',
        h('div.row', h('b', offRef.name), h('span.tag', 'Mão livre'), d.equip.offStowed || dv.hands.twoHanded ? h('span.tag.danger', 'guardado') : h('span.tag', 'em mãos')),
        isRev ? h('div.small', `Dano ${damageText(offRef.damage)} · ${offRef.pa} PA · munição ${off.ammo ?? 0}/${offRef.ammoCapacity}${offRef.text ? ` · ${offRef.text}` : ''}`) : h('div.small', offRef.text || ''),
        h('div.row',
          isRev ? h('button', { onclick: () => attackDialog(a, { weapon: off.uid }) }, '🔫 Disparar') : h('button', { onclick: () => castDialog(a) }, '✦ Conjurar'),
          isRev ? h('button', { onclick: () => act('hands', { actorId: a.id, op: 'reload', uid: off.uid }) }, 'Recarregar (1 PA)') : null,
          d.equip.offStowed ? h('button', { onclick: () => act('hands', { actorId: a.id, op: 'drawOff' }) }, 'Sacar (1 PA)') : h('button', { onclick: () => act('hands', { actorId: a.id, op: 'stowOff' }) }, 'Guardar (1 PA)')),
        isRev ? h('div.small.muted', `Contra-Tiro: reação de ${dv.mods?.counterShotCost ?? rc.counterShot.cost} PA guardados, oferecida automaticamente quando uma criatura atacar você.`) : null));
    }
    // Ações
    const groups = {};
    for (const x of rc.actions) (groups[x.group] = groups[x.group] || []).push(x);
    out.append(h('div.section-title', 'Ações'));
    for (const [g, list] of Object.entries(groups)) {
      out.append(h('div.small.muted', g), h('div.row.actions-row', ...list.map(x => h('button.small', { title: `${x.pa} PA${x.roll ? ` · ${attrName(x.roll[0])} + ${skillName(x.roll[1])}` : ''}`, onclick: () => act('generic', { actorId: a.id, id: x.id }) }, `${x.name} · ${x.pa}`))));
    }
    out.append(h('div.row', { style: { marginTop: '6px' } },
      h('button.small', { onclick: () => attackDialog(a, { weapon: 'unarmed' }) }, 'Ataque desarmado'),
      h('button.small', { onclick: () => castDialog(a) }, '✦ Arcano'),
      h('button.small', { onclick: () => markDialog(a) }, '✧ Marca')));
    return out;
  }

  function stateAdder(a) {
    const sel = h('select.small', ...R().states.states.map(s => h('option', { value: s.id }, `${s.icon || ''} ${s.name}`)));
    const rounds = h('input.small', { type: 'number', placeholder: 'turnos', style: { width: '70px' } });
    const value = h('input.small', { type: 'number', placeholder: 'valor', style: { width: '64px' } });
    return h('div.row.small', sel, rounds, value, h('button.small', { onclick: () => act('state', { actorId: a.id, state: sel.value, rounds: rounds.value, value: value.value }) }, '+ Estado'));
  }

  // ---------------- Aba Arsenal ----------------
  function arsenal(a, d) {
    const out = h('div');
    const ed = editable();
    out.append(h('div.section-title', 'Armas da Oficina (TOC)'));
    for (const w of d.weapons) {
      const ref = IDX().weapons[w.ref];
      if (!ref) continue;
      const reforco = h('select.small', { disabled: !ed }, ...[0, ...R().discernment.reinforcement.map(x => x.level)].map(l => h('option', { value: l, selected: l === (w.reforco || 0) }, l ? `Reforço ${'I'.repeat(l)}` : 'Sem reforço')));
      reforco.addEventListener('change', () => upd({ weapons: d.weapons.map(x => x.uid === w.uid ? { ...x, reforco: Number(reforco.value) } : x) }));
      out.append(h('div.weapon-card',
        h('div.row', h('b', ref.name), ref.legendary ? h('span.tag.gold', 'Lendária') : null, d.equip.main === w.uid ? h('span.tag', 'empunhada') : null, h('span.small.muted', `${ref.slots ?? 2} espaço(s)`)),
        h('div.small', `Padrão: ${ref.forms.padrao.name} (${damageText(ref.forms.padrao.damage)}) · Truque: ${ref.forms.truque.name} (${damageText(ref.forms.truque.damage)}${ref.forms.truque.trick ? ` + ${damageText(ref.forms.truque.trick)}` : ''})`),
        h('div.row', reforco,
          d.equip.main !== w.uid ? h('button.small', { disabled: !ed, onclick: () => act('hands', { actorId: a.id, op: 'setMain', uid: w.uid }) }, 'Empunhar') : null,
          h('button.small.ghost', { onclick: () => app.openCompendiumEntry?.('weapons', ref.id) }, 'Ler'),
          ed ? h('button.small.ghost', { onclick: () => upd({ weapons: d.weapons.filter(x => x.uid !== w.uid), ...(d.equip.main === w.uid ? { equip: { main: null } } : {}) }) }, '🗑') : null)));
    }
    if (ed) out.append(adder('weapons', 'Adicionar arma'));
    out.append(h('div.section-title', 'Revólveres'));
    for (const r of d.revolvers) {
      const ref = IDX().revolvers[r.ref];
      if (!ref) continue;
      out.append(h('div.weapon-card', h('div.row', h('b', ref.name), d.equip.off === r.uid ? h('span.tag', 'mão livre') : null, h('span.small.muted', `${damageText(ref.damage)} · ${ref.pa} PA · ${r.ammo}/${ref.ammoCapacity}`)),
        h('div.row',
          d.equip.off !== r.uid ? h('button.small', { disabled: !ed, onclick: () => act('hands', { actorId: a.id, op: 'setOff', uid: r.uid }) }, 'Pôr na mão livre') : null,
          ed ? h('button.small.ghost', { onclick: () => upd({ revolvers: d.revolvers.filter(x => x.uid !== r.uid), ...(d.equip.off === r.uid ? { equip: { off: null } } : {}) }) }, '🗑') : null)));
    }
    if (ed) out.append(adder('revolvers', 'Adicionar revólver'));
    out.append(h('div.section-title', 'Canalizadores'));
    for (const c of d.channelers) {
      const ref = IDX().channelers[c.ref];
      if (!ref) continue;
      out.append(h('div.weapon-card', h('div.row', h('b', ref.name), d.equip.off === c.uid ? h('span.tag', 'mão livre') : null, h('span.small.muted', `${ref.kind} · ${ref.text}`)),
        h('div.row',
          d.equip.off !== c.uid ? h('button.small', { disabled: !ed, onclick: () => act('hands', { actorId: a.id, op: 'setOff', uid: c.uid }) }, 'Pôr na mão livre') : null,
          ed ? h('button.small.ghost', { onclick: () => upd({ channelers: d.channelers.filter(x => x.uid !== c.uid), ...(d.equip.off === c.uid ? { equip: { off: null } } : {}) }) }, '🗑') : null)));
    }
    if (ed) out.append(adder('channelers', 'Adicionar Canalizador'));
    out.append(h('p.small.muted', 'Dica: arraste itens do Compêndio (📖) direto para esta ficha.'));
    return out;
  }

  function adder(pack, label, filter = () => true) {
    const entries = (app.state.system.compendium[pack]?.entries || []).filter(filter);
    const sel = h('select.small', h('option', { value: '' }, `— ${label} —`), ...entries.map(e => h('option', { value: e.id }, e.name + (e.discernment != null ? ` (D${e.discernment})` : ''))));
    sel.addEventListener('change', () => { if (sel.value) addToActor(actor(), pack, IDX()[pack][sel.value]); });
    return h('div.row', sel);
  }

  // ---------------- Aba Arcanos & Marcas ----------------
  function arcano(a, d, dv) {
    const out = h('div');
    const cls = classDef(d.class);
    const ed = editable();
    const prepared = d.arcana.prepared || [];
    out.append(h('div.row', h('b', `Espaços de Magia: ${prepared.length}/${dv.spellSlots}`), h('span.small.muted', `Academias: ${cls.academies.map(x => R().classes.academies.find(y => y.id === x)?.name).join(' e ')} · ${dv.hands.channelerInHand ? 'Canalizador em mãos' : 'sem Canalizador em mãos'}`)));
    out.append(h('div.small.muted', 'Marque os Arcanos preparados. Trocar exige descanso ou a Oficina (fora de combate).'));
    for (const id of d.arcana.known || []) {
      const ar = IDX().arcana[id];
      if (!ar) continue;
      const prep = prepared.includes(id);
      const cb = h('input', { type: 'checkbox', checked: prep, disabled: !ed });
      cb.addEventListener('change', () => act('prepare', { actorId: a.id, prepared: cb.checked ? [...prepared, id] : prepared.filter(x => x !== id) }));
      const cd = d.arcana.cooldowns?.[id];
      const row = h('div.list-row',
        cb,
        h('div.grow', h('b', ar.name), ' ', h('span.small.muted', `${R().classes.academies.find(x => x.id === ar.academy)?.name} · D${ar.discernment} · ${ar.pa} PA${ar.noCooldown ? ' · sem recarga' : ''}${cd ? ` · recarga até rodada ${cd}` : ''}`), h('div.small', ar.text)),
        prep ? h('button.small', { onclick: () => castDialog(a, id) }, 'Conjurar') : null,
        ed ? h('button.small.ghost', { onclick: () => upd({ arcana: { known: d.arcana.known.filter(x => x !== id), prepared: prepared.filter(x => x !== id) } }) }, '✕') : null);
      out.append(row);
    }
    if (ed) out.append(adder('arcana', 'Aprender Arcano', (e) => isGM() || (cls.academies.includes(e.academy) && e.discernment <= d.discernment)));
    out.append(h('div.section-title', 'Marcas do Caçador'));
    for (const id of d.marks || []) {
      const mk = IDX().marks[id];
      if (!mk) continue;
      const qty = (d.inventory || []).filter(i => i.ref === mk.material).reduce((s, i) => s + i.qty, 0);
      out.append(h('div.list-row',
        h('div.grow', h('b', mk.name), ' ', h('span.small.muted', `D${mk.discernment} · ${mk.pa} PA · ${IDX().items[mk.material]?.name || mk.material}: ${qty}`), h('div.small', mk.text)),
        h('button.small', { disabled: !qty, onclick: () => markDialog(a, id) }, 'Usar'),
        ed ? h('button.small.ghost', { onclick: () => upd({ marks: d.marks.filter(x => x !== id) }) }, '✕') : null));
    }
    if (ed) out.append(adder('marks', 'Aprender Marca', (e) => isGM() || e.discernment <= d.discernment));
    return out;
  }

  // ---------------- Aba Inventário ----------------
  function inventario(a, d, dv) {
    const out = h('div');
    const ed = editable();
    out.append(h('div.row', h('b', `Carga: ${dv.carryUsed}/${dv.carryMax} espaços`), dv.carryUsed > dv.carryMax ? h('span.danger.small', `Sobrecarga: -${(dv.carryUsed - dv.carryMax) * R().between.carry.movePenaltyPerSlot} m de movimento${dv.carryUsed - dv.carryMax >= R().between.carry.heavyOverloadAt ? ', Desvantagem em ataques, sem Esquiva/Saltar/Escalar' : ''}`) : null));
    const list = h('div');
    for (const it of d.inventory || []) {
      const ref = it.ref ? IDX().items[it.ref] : null;
      const qty = h('input', { type: 'number', value: it.qty, min: 0, 'data-key': `inv-${it.uid}`, disabled: !ed, style: { width: '64px' } });
      qty.addEventListener('change', () => upd({ inventory: d.inventory.map(x => x.uid === it.uid ? { ...x, qty: Number(qty.value) } : x) }));
      list.append(h('div.list-row',
        h('div.grow', h('b', it.name), ref ? h('span.small.muted', ` ${ref.category}${ref.text ? ` · ${ref.text}` : ''}`) : null),
        qty,
        ref && ['consumivel'].includes(ref.category) ? h('button.small', { disabled: !it.qty, onclick: () => act('useItem', { actorId: a.id, uid: it.uid }) }, 'Usar') : null,
        ed ? h('button.small.ghost', { onclick: () => upd({ inventory: d.inventory.filter(x => x.uid !== it.uid) }) }, '✕') : null));
    }
    out.append(list);
    if (ed) {
      const custom = h('input', { placeholder: 'Item personalizado', 'data-key': 'custom-item' });
      out.append(adder('items', 'Adicionar do compêndio'), h('div.row', custom, h('button.small', { onclick: () => { if (custom.value.trim()) upd({ inventory: [...d.inventory, { uid: uid(), ref: null, name: custom.value.trim(), qty: 1 }] }); } }, '+ Adicionar')));
    }
    return out;
  }

  // ---------------- Aba Progressão ----------------
  function progressao(a, d, dv) {
    const out = h('div');
    const ed = editable();
    const disc = R().discernment;
    const r = dv.rewards;
    out.append(h('div.section-title', `Discernimento ${d.discernment} — ${dv.discernmentStage.name}`),
      h('div.small', `Marcos alcançados: ${dv.milestones} de ${disc.max / disc.milestoneEvery}. Escolhas (Arcano ou Marca): ${r.choices} · Talentos: ${r.talents} · Pontos de atributo: ${r.attributePoints} · Níveis de perícia: ${r.skillLevels}.`),
      h('div.row', h('button.small', { onclick: () => act('milestoneSanity', { actorId: a.id }) }, `Marco: Sanidade Difícil para reduzir ${R().dementia.milestoneReduction.reduce} de Dementia`)));
    out.append(h('div.section-title', `Talentos (${(d.talents || []).length}/${r.talents})`));
    for (const id of d.talents || []) {
      const t = IDX().talents[id];
      if (t) out.append(h('div.list-row', h('div.grow', h('b', t.name), h('span.small.muted', ` ${t.category}`), h('div.small', t.text)), ed ? h('button.small.ghost', { onclick: () => upd({ talents: d.talents.filter(x => x !== id) }) }, '✕') : null));
    }
    if (ed) out.append(adder('talents', 'Adicionar Talento', (t) => !(d.talents || []).includes(t.id) && (!t.classOnly || t.classOnly === d.class)));
    out.append(h('div.section-title', `Mutações — Dementia ${d.dementia} (${dv.dementiaStage.name})`), h('div.small.muted', dv.dementiaStage.text));
    for (const id of d.mutations || []) {
      const m = IDX().mutations[id];
      if (m) out.append(h('div.list-row', h('div.grow', h('b', m.name), h('span.small.muted', ` ${R().dementia.mutationGrades.find(g => g.id === m.grade)?.name}`), h('div.small', m.text)), isGM() ? h('button.small.ghost', { onclick: () => upd({ mutations: d.mutations.filter(x => x !== id) }) }, '✕') : null));
    }
    const pending = pendingMutations(d);
    if (pending.length) out.append(h('div.small.danger', `Mutação pendente: ${pending.join(', ')}. Escolha com o Mestre.`));
    if (isGM()) out.append(adder('mutations', 'Adicionar mutação (Mestre)'));
    out.append(h('div.section-title', 'Humanitas'),
      h('div.small', `${d.humanitas > 0 ? '+' : ''}${d.humanitas} — ${dv.humanitasBand.name}. Recupera no máximo ${R().humanitas.maxRecoveryPerSession} por sessão. Administrada pelo Mestre.`));
    return out;
  }

  // ---------------- Aba Notas ----------------
  function notas(a, d) {
    const ed = editable();
    const mk = (key, label) => {
      const ta = h('textarea', { rows: 8, 'data-key': key, disabled: !ed }, d[key] || '');
      ta.addEventListener('change', () => upd({ [key]: ta.value }));
      return [h('div.section-title', label), ta];
    };
    const size = h('input', { type: 'number', value: d.tokenSize || 1, step: 0.5, min: 0.5, max: 4, disabled: !ed });
    size.addEventListener('change', () => upd({ tokenSize: Number(size.value) }));
    return h('div', ...mk('biography', 'História'), ...mk('appearance', 'Aparência e mutações escondidas'), ...mk('notes', 'Anotações'),
      h('div.row', { style: { marginTop: '8px' } }, h('span.small', 'Tamanho do token'), size,
        h('button.small', { onclick: async () => { const r = await call('actor:export', { id: a.id }); if (r.export) app.ui.downloadJSON(`${a.name}.json`, r.export); } }, '⤓ Exportar JSON'),
        ed ? h('button.small', { onclick: async () => { const json = await app.ui.readJSONFile(); if (json) call('actor:import', { id: a.id, json }); } }, '⤒ Importar por cima') : null,
        isGM() ? linkSelect(a) : null));
  }

  function linkSelect(a) {
    const players = app.state.users.filter(u => u.role === 'player');
    const sel = h('select.small', h('option', { value: '' }, 'Sem jogador'), ...players.map(p => h('option', { value: p.id, selected: p.id === a.owner_id }, `Jogador: ${p.name}`)));
    sel.addEventListener('change', () => call('actor:link', { id: a.id, userId: sel.value ? Number(sel.value) : null }));
    return sel;
  }

  // Visão limitada de outro caçador
  function publicView(a) {
    const d = a.data;
    return h('div',
      h('div.sheet-header', h('div.portrait', a.img ? h('img', { src: a.img, alt: a.name }) : h('span', a.name.slice(0, 2))),
        h('div.col', h('h2', a.name), h('div.muted', classDef(d.class)?.name || ''))),
      h('div.tracks', h('div.track.blood', h('div.track-label', 'Vida'), h('div.track-big', `${d.hp?.value ?? '?'} / ${d.hp?.max ?? '?'}`)), h('div.track.bronze', h('div.track-label', 'Guarda'), h('div.track-big', `${d.guard?.value ?? '?'} / ${d.guard?.max ?? '?'}`))),
      d.states?.length ? h('div.chips', ...d.states.map(s => stateChip(s))) : null);
  }

  // Aceita itens arrastados do Compêndio
  win.el.addEventListener('dragover', (e) => e.preventDefault());
  win.el.addEventListener('drop', (e) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('application/x-questvtt')); } catch { return; }
    if (data?.type === 'compendium') addToActor(actor(), data.pack, IDX()[data.pack]?.[data.id]);
  });

  const off = app.on(`actor:${actorId}`, () => render());
  const offSys = app.on('system', () => render());
  const oldClose = win.close;
  win.close = () => { off(); offSys(); oldClose(); };
  render();
}
