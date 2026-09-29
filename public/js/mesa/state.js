// Estado do cliente + barramento de eventos simples.
export const state = {
  user: null,
  tableName: '',
  users: [],
  actors: new Map(),
  scenes: [],
  activeSceneId: null,
  scene: null,          // { scene, tokens: Map, walls: Map, lights: Map, fog }
  chat: [],
  combat: null,
  journal: new Map(),
  playlists: [],
  audio: null,
  rolltables: [],
  handout: null,
  system: null,         // { manifest, rules, compendium, index }
  selected: new Set(),  // tokens selecionados
  targets: new Set(),   // tokens marcados como alvo
  speakerActorId: null  // ficha "falante" no chat
};

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, data) {
  for (const fn of listeners.get(event) || []) {
    try { fn(data); } catch (err) { console.error(`Erro no ouvinte de ${event}:`, err); }
  }
}

export const isGM = () => state.user?.role === 'gm';
export const isSpectator = () => state.user?.role === 'spectator';

// Ficha principal do usuário (o caçador vinculado).
export function myActor() {
  if (state.speakerActorId && state.actors.has(state.speakerActorId)) return state.actors.get(state.speakerActorId);
  for (const a of state.actors.values()) if (a.owner_id === state.user?.id && a.full) return a;
  return null;
}

export function canControl(actor) {
  if (!actor) return false;
  return isGM() || (actor.owner_id === state.user?.id && state.user?.role === 'player');
}

export function userById(id) { return state.users.find(u => u.id === id); }
