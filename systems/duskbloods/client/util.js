// Utilidades compartilhadas do cliente DuskBloods.
export const ctx = { app: null };

export const R = () => ctx.app.state.system.rules;
export const IDX = () => ctx.app.state.system.index;
export const h = (...a) => ctx.app.ui.h(...a);
export const call = (...a) => ctx.app.call(...a);
export const isGM = () => ctx.app.isGM();
export const esc = (s) => ctx.app.ui.esc(s);

export const uid = () => Math.random().toString(16).slice(2, 12);

export const attrName = (id) => R().attributes.attributes.find(a => a.id === id)?.name || id;
export const skillName = (id) => R().attributes.skills.find(s => s.id === id)?.name || id;
export const stateDef = (id) => R().states.states.find(s => s.id === id);
export const classDef = (id) => R().classes.classes.find(c => c.id === id);
export const tierDef = (id) => R().combat.creatureTiers.find(t => t.id === id);

export function act(action, payload) {
  return call('sys:action', { action, ...payload });
}

export function targets() { return [...ctx.app.state.targets]; }

export function stateChip(s, { onRemove } = {}) {
  const def = stateDef(s.id);
  const label = `${def?.icon || '•'} ${def?.name || s.id}${s.value ? ` ${s.value}` : ''}${s.rounds != null ? ` (${s.rounds})` : ''}`;
  const el = h('span.chip', { class: `chip ${def?.group || ''}` }, label, onRemove ? h('button.chip-x', { title: 'Remover', onclick: onRemove }, '×') : null);
  ctx.app.ui.tooltip(el, () => `<b>${esc(def?.name || s.id)}</b>${def?.category ? ` <span class="muted">(${def.category})</span>` : ''}<br>${esc(def?.text || '')}${s.rounds != null ? `<br><i>Restam ${s.rounds} turno(s).</i>` : ''}`);
  return el;
}

export function damageText(parts) {
  return (parts || []).map(p => `${p.dice} ${p.type}`).join(' + ');
}

// Todas as fichas de caçador que o usuário controla.
export function myHunters() {
  return [...ctx.app.state.actors.values()].filter(a => a.full && a.type === 'hunter' && (isGM() || a.owner_id === ctx.app.state.user.id));
}

export function currentActor() {
  const st = ctx.app.state;
  if (st.speakerActorId && st.actors.get(st.speakerActorId)?.full) return st.actors.get(st.speakerActorId);
  return [...st.actors.values()].find(a => a.full && a.owner_id === st.user.id) || null;
}
