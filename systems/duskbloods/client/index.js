// Módulo de cliente do sistema DuskBloods (carregado pela mesa do QuestVTT).
// Fornece os "ganchos" que o núcleo usa: ficha, cartões do chat, barras do token, etc.
import { ctx, h, R, IDX, act, isGM, call, stateDef, classDef, tierDef, currentActor } from './util.js';
import { renderChatCard, rollButtons } from './cards.js';
import { openHunterSheet } from './sheet-hunter.js';
import { openCreatureSheet } from './sheet-creature.js';
import { attackDialog, castDialog, markDialog, creatureAttackDialog, createActorDialog } from './dialogs.js';
import { compendiumSubtitle, renderCompendiumEntry } from './compendium.js';

export { renderChatCard, rollButtons, compendiumSubtitle, renderCompendiumEntry, createActorDialog };

export function init(app) {
  ctx.app = app;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/systems/duskbloods/duskbloods.css';
  document.head.append(link);
  initHotbar(app);
  initReaction(app);
  initDementiaFx(app);
}

export function openSheet(actor) {
  if (!actor) return;
  if (actor.type === 'hunter') openHunterSheet(actor.id);
  else if (isGM() || actor.full) openCreatureSheet(actor.id);
  else openCreatureSheet(actor.id);
}

// Barras e ícones do token.
export function tokenInfo(actor) {
  const d = actor.data || {};
  const icons = (d.states || []).map(s => stateDef(s.id)?.icon).filter(Boolean);
  if (actor.type === 'hunter') {
    const hpMax = actor.derived?.hpMax ?? d.hp?.max;
    const gMax = actor.derived?.guardMax ?? d.guard?.max;
    return {
      bars: [{ value: d.hp?.value, max: hpMax, color: 0xb22a2a }, { value: d.guard?.value, max: gMax, color: 0xc9a45c }],
      icons: d.dying ? ['🕯', ...icons.filter(i => i !== '🕯')] : icons
    };
  }
  const defeated = d.hp?.value != null && d.hp.value <= 0 || d.defeated;
  return { bars: d.hp && d.hp.max ? [{ value: d.hp.value, max: d.hp.max, color: 0x8b1a1a }] : [], icons, defeated };
}

// Luz carregada pela arma (Incensário de Varsuke na Forma Padrão).
export function tokenLight(token, actor) {
  if (!actor || actor.type !== 'hunter' || !actor.full) return null;
  const d = actor.data;
  const w = d.weapons?.find(x => x.uid === d.equip?.main);
  const light = w && IDX().weapons[w.ref]?.forms[w.form]?.effects?.light;
  return light && !d.equip?.mainStowed ? { radius: light, color: '#ffb85c' } : null;
}

export function tokenMenu(actor, token) {
  if (!actor) return [];
  const items = [];
  const mine = actor.full;
  if (actor.type === 'hunter' && mine) {
    items.push({ label: '⚔ Atacar…', action: () => attackDialog(actor) });
    items.push({ label: '✦ Arcano…', action: () => castDialog(actor) });
    items.push({ label: '🩸 Beber Frasco de Sangue', action: () => act('flask', { actorId: actor.id }) });
  }
  if (actor.type === 'creature' && isGM()) {
    (actor.data.attacks || []).forEach((a, i) => items.push({ label: `⚔ ${a.name}`, action: () => creatureAttackDialog(actor, i) }));
    items.push({ label: actor.data.showBars ? '▭ Esconder Vida dos jogadores' : '▬ Mostrar Vida aos jogadores', action: () => call('actor:update', { id: actor.id, data: { showBars: !actor.data.showBars } }) });
    items.push({ label: '▲ Avançar fase / Postura Elevada', action: () => act('phase', { actorId: actor.id }) });
  }
  if (isGM()) {
    items.push({ label: '✚ Curar / ✖ Dano…', action: () => quickAdjust(actor) });
    items.push({ label: '✖ Aplicar Fractura', action: () => act('state', { actorId: actor.id, state: 'fractura', rounds: 1 }) });
    if (actor.type === 'hunter') items.push({ label: '☠ Morte (Ecos no cadáver)', action: () => act('death', { actorId: actor.id }) });
  }
  return items;
}

export function corpseMenu(token) {
  const me = currentActor();
  if (!me || me.type !== 'hunter') return [];
  if (token.data.owner && token.data.owner !== me.id && !isGM()) return [];
  return [{ label: `🩸 Recuperar ${token.data.ecos ?? 0} Ecos (${me.name})`, action: () => act('recoverEcos', { actorId: me.id, tokenId: token.id }) }];
}

async function quickAdjust(actor) {
  const r = await ctx.app.ui.formDialog(`Vida — ${actor.name}`, [
    { name: 'amount', label: 'Quantidade', type: 'number', value: 1 },
    { name: 'mode', label: 'Tipo', type: 'select', value: 'damage', options: [{ value: 'damage', label: 'Dano' }, { value: 'heal', label: 'Cura' }] },
    { name: 'type', label: 'Tipo de dano', type: 'select', value: '', options: [{ value: '', label: '— (sem tipo)' }, ...R()['damage-types'].types.map(t => ({ value: t.id, label: `${t.name} (${t.plain})` }))] },
    { name: 'massive', label: 'Massivo (ignora Redução)', type: 'checkbox', value: false },
    { name: 'guard', label: 'Tirar 1 de Guarda (caçador)', type: 'checkbox', value: false }
  ]);
  if (r) act('adjust', { actorIds: [actor.id], amount: r.amount, mode: r.mode, type: r.type || null, massive: r.massive, guard: r.guard });
}

export function actorSubtitle(a) {
  const d = a.data || {};
  if (a.type === 'hunter') return `${classDef(d.class)?.name || 'Caçador'}${a.full && d.hp ? ` · Vida ${d.hp.value}/${a.derived?.hpMax}` : ''}`;
  return `${tierDef(d.tier)?.name || 'Criatura'}${d.hp?.max ? ` · Vida ${d.hp.value}/${d.hp.max}` : ''}`;
}

export function combatantInfo(actor) {
  const d = actor.data || {};
  if (actor.type === 'hunter') {
    const paMax = actor.derived?.paMax ?? d.pa?.max ?? 8;
    return `PA <b>${d.pa?.value ?? '?'}</b>/${paMax} · Vida ${d.hp?.value ?? '?'}/${actor.derived?.hpMax ?? d.hp?.max ?? '?'} · Guarda ${d.guard?.value ?? '?'}${d.defense ? ` · ${d.defense.name}` : ''}${d.dying ? ' · 🕯 Morrendo' : ''}`;
  }
  if (!actor.full) return d.hp ? `Vida ${d.hp.value}/${d.hp.max}` : '';
  return `PA <b>${d.pa?.value ?? '?'}</b>/${d.pa?.max ?? '?'} · Vida ${d.hp?.value ?? '?'}/${d.hp?.max ?? '?'} · Limiar ${actor.derived?.limiar ?? d.limiar ?? '?'}`;
}

// Configurações pessoais (efeitos de Dementia) e do Mestre (dano automático, descanso).
export function personalSettings() {
  const cb = h('input', { type: 'checkbox', checked: fxEnabled() });
  cb.addEventListener('change', () => { try { localStorage.setItem('qvtt.dementiaFx', cb.checked ? '1' : '0'); } catch { /* ok */ } applyFx(); });
  return h('label.row.small', cb, 'Efeitos visuais de Dementia na minha tela (vinheta, distorção, sussurros)');
}

export function gmSettings(app) {
  const box = h('div.col', h('div.group-title', 'DuskBloods'));
  const auto = h('input', { type: 'checkbox' });
  act('settings', {}).then(r => { auto.checked = !!r.autoApply; });
  auto.addEventListener('change', () => act('autoApply', { value: auto.checked }));
  box.append(
    h('label.row.small', auto, 'Aplicar dano automaticamente nos ataques'),
    h('div.row', h('button.small', { onclick: () => act('rest', { dream: false }) }, 'Descanso (todos os caçadores)'), h('button.small', { onclick: () => act('rest', { dream: true }) }, 'Descanso no Sonho')),
    h('div.small.muted', 'Descanso: metade da Vida, Guarda cheia, recargas renovadas. No Sonho: Vida cheia.'));
  return box;
}

// ---------------- Barra rápida (hotbar) ----------------
function initHotbar(app) {
  const el = document.getElementById('hotbar');
  const render = () => {
    el.replaceChildren();
    // Mestre com criatura selecionada: ataques rápidos
    if (isGM()) {
      const tok = [...app.state.selected].map(id => app.state.scene?.tokens.get(id)).find(t => t?.actor_id);
      const a = tok && app.state.actors.get(tok.actor_id);
      if (a && a.type === 'creature') {
        el.append(h('span.hb-stat', a.name), h('span.hb-stat', 'PA ', h('b', `${a.data.pa?.value ?? '?'}`)), h('span.hb-stat', 'Vida ', h('b', `${a.data.hp?.value ?? '?'}/${a.data.hp?.max ?? '?'}`)),
          ...(a.data.attacks || []).map((atk, i) => h('button.small', { onclick: () => creatureAttackDialog(a, i) }, `⚔ ${atk.name}`)),
          h('button.small', { onclick: () => openSheet(a) }, 'Ficha'));
        return;
      }
    }
    const a = currentActor();
    if (!a || a.type !== 'hunter' || !a.full) return;
    const d = a.data, dv = a.derived;
    el.append(
      h('span.hb-stat', { title: 'Vida' }, '❤ ', h('b', `${d.hp.value}/${dv.hpMax}`)),
      h('span.hb-stat', { title: 'Guarda' }, '🛡 ', h('b', `${d.guard.value}/${dv.guardMax}`)),
      h('span.hb-stat', { title: 'Pontos de Ação' }, 'PA ', h('b', `${d.pa.value}/${dv.paMax}`)),
      h('span.hb-stat', { title: dv.limiarBreakdown.join(' · ') }, 'Limiar ', h('b', `${dv.limiar}`)),
      h('button.small.primary', { onclick: () => attackDialog(a) }, '⚔ Atacar'),
      ...R().combat.defenses.slice(0, 3).map(x => h('button.small', { class: d.defense?.id === x.id ? 'small active' : 'small', title: `${x.pa} PA`, onclick: () => act('defend', { actorId: a.id, defense: x.id }) }, x.name)),
      h('button.small', { title: `${d.flasks} Frascos`, onclick: () => act('flask', { actorId: a.id }) }, `🩸 ${d.flasks}`),
      h('button.small', { onclick: () => castDialog(a) }, '✦'),
      h('button.small', { onclick: () => markDialog(a) }, '✧'),
      h('button.small', { onclick: () => openSheet(a) }, 'Ficha'));
  };
  for (const ev of ['actors', 'selection', 'world:reset', 'combat']) app.on(ev, render);
}

// ---------------- Reação: Contra-Tiro ----------------
function initReaction(app) {
  const el = document.getElementById('reaction');
  let current = null;
  let timer = null;
  app.on('sys:reaction', (p) => {
    current = p;
    el.className = 'reaction frame';
    const bar = h('div.timer');
    el.replaceChildren(
      h('h3', '⚠ Contra-Tiro!'),
      h('p', h('b', p.attacker), ` ataca ${p.forGM ? p.target : 'você'} com `, h('b', p.attack), '.'),
      h('p.small.muted', `Reação: ${p.cost} PA guardados · Percepção + Armas de Fogo contra o Limiar do atacante. Acertou: o golpe é cancelado e o atacante entra em Fractura.`),
      p.forGM ? h('p.small.gold', p.ownerOnline ? 'O jogador está decidindo… você também pode responder.' : 'O jogador está offline: decida por ele.') : null,
      bar,
      h('div.row', { style: { justifyContent: 'center' } },
        h('button.primary', { onclick: () => answer(true) }, `🔫 Contra-Tiro (${p.cost} PA)`),
        h('button', { onclick: () => answer(false) }, 'Deixar passar')));
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: p.timeout * 1000, fill: 'forwards' });
    clearTimeout(timer);
    timer = setTimeout(close, p.timeout * 1000 + 500);
  });
  app.on('sys:reactionClosed', (p) => { if (current && current.id === p.id) close(); });
  function answer(use) {
    if (!current) return;
    call('sys:react', { id: current.id, use });
    close();
  }
  function close() { el.className = 'reaction hidden'; current = null; clearTimeout(timer); }
}

// ---------------- Efeitos de Dementia (só na tela do dono) ----------------
const fxEnabled = () => localStorage.getItem('qvtt.dementiaFx') !== '0';
let lastWhisper = Date.now();
function myDementiaFx() {
  if (isGM() || !ctx.app) return 0;
  const mine = [...ctx.app.state.actors.values()].find(a => a.full && a.type === 'hunter' && a.owner_id === ctx.app.state.user.id);
  return mine?.derived?.dementiaStage?.fx || 0;
}
function applyFx() {
  const el = document.getElementById('dementiaFx');
  const fx = fxEnabled() ? myDementiaFx() : 0;
  el.className = `dementia-fx${fx ? ` fx${fx}` : ''}`;
  for (let i = 1; i <= 5; i++) document.body.classList.remove(`fx-distort-${i}`);
  if (fx >= 3) document.body.classList.add(`fx-distort-${fx}`);
}
function initDementiaFx(app) {
  app.on('actors', applyFx);
  app.on('world:reset', applyFx);
  // Sussurros: aparecem só no chat deste jogador.
  setInterval(() => {
    if (!fxEnabled()) return;
    const fx = myDementiaFx();
    const cfg = R().dementia.screenEffects;
    if (!fx || fx < cfg.whisperMinFx) return;
    const minutes = cfg.whisperEveryMinutes / Math.max(1, fx - cfg.whisperMinFx + 1);
    if (Date.now() - lastWhisper < minutes * 60000 * (0.6 + Math.random() * 0.8)) return;
    lastWhisper = Date.now();
    const text = cfg.whispers[Math.floor(Math.random() * cfg.whispers.length)];
    app.localMessage?.(`<i>${text}</i>`);
  }, 20000);
}
