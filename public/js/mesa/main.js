// Ponto de entrada da mesa: carrega sistema, estado inicial e liga todos os módulos.
import { state, on, emit, isGM } from './state.js';
import { socket, call, upload, getJSON } from './net.js';
import * as ui from './ui.js';
import { initSidebar } from './sidebar.js';
import { initBoard } from './board/board.js';
import { initPlayers } from './players.js';
import { initAudio } from './audio.js';
import { initHandout } from './handout.js';

async function boot() {
  const me = await getJSON('/api/me');
  if (!me.user || me.user.status !== 'approved') { location.href = '/'; return; }

  await loadSystem();
  const sysModule = await import(`/systems/${state.system.id}/index.js`);

  // Objeto "app" entregue ao módulo do sistema (como a API do Foundry).
  const app = { state, on, emit, call, upload, ui, isGM, socket, system: null, board: null };
  window.questvtt = app; // útil para depuração no console

  socket.on('world:state', (st) => {
    Object.assign(state, {
      user: st.user, tableName: st.tableName, users: st.users, scenes: st.scenes,
      activeSceneId: st.activeSceneId, chat: st.chat, combat: st.combat, playlists: st.playlists,
      audio: st.audio, rolltables: st.rolltables, handout: st.handout
    });
    state.actors = new Map(st.actors.map(a => [a.id, a]));
    state.journal = new Map(st.journal.map(j => [j.id, j]));
    document.title = `${st.tableName} — QuestVTT`;
    if (!app.started) start();
    else emit('world:reset');
  });

  async function start() {
    app.started = true;
    document.getElementById('loading').remove();
    document.getElementById('app').classList.remove('hidden');
    document.body.classList.toggle('is-gm', isGM());
    app.system = sysModule;
    app.board = await initBoard(app);
    initSidebar(app);
    initPlayers(app);
    initAudio(app);
    initHandout(app);
    if (sysModule.init) sysModule.init(app);
    emit('world:reset');
  }

  bindSocket(app);
  socket.connect();
}

async function loadSystem() {
  const sys = await getJSON('/api/system');
  sys.index = {};
  for (const [name, pack] of Object.entries(sys.compendium)) sys.index[name] = Object.fromEntries(pack.entries.map(e => [e.id, e]));
  state.system = sys;
}

function bindSocket(app) {
  const disc = document.getElementById('disconnected');
  socket.on('disconnect', () => disc?.classList.remove('hidden'));
  socket.on('connect', () => disc?.classList.add('hidden'));
  socket.on('connect_error', async () => {
    // Sessão expirada? Volta para a entrada.
    try { const me = await getJSON('/api/me'); if (!me.user) location.href = '/'; } catch { /* servidor fora do ar */ }
  });
  socket.on('auth:pending', () => { location.href = '/'; });

  // --- Usuários ---
  socket.on('users:update', (users) => { state.users = users; emit('users'); });
  socket.on('users:pending', (u) => { if (isGM()) ui.toast(`${u.name} quer entrar na mesa. Aprove na aba ⚙.`, 'info', 6000); });

  // --- Fichas ---
  socket.on('actor:update', (a) => { state.actors.set(a.id, a); emit('actors'); emit(`actor:${a.id}`, a); });
  socket.on('actor:delete', ({ id }) => { state.actors.delete(id); emit('actors'); emit(`actor:${id}`, null); });

  // --- Cena ---
  socket.on('scene:load', (bundle) => {
    if (!bundle) { state.scene = null; emit('scene'); return; }
    state.scene = {
      scene: bundle.scene,
      tokens: new Map(bundle.tokens.map(t => [t.id, t])),
      walls: new Map(bundle.walls.map(w => [w.id, w])),
      lights: new Map(bundle.lights.map(l => [l.id, l])),
      fog: bundle.fog
    };
    state.selected.clear(); state.targets.clear();
    emit('scene');
  });
  socket.on('scene:updated', (scene) => { if (state.scene && state.scene.scene.id === scene.id) { state.scene.scene = scene; emit('scene:config'); } });
  socket.on('scene:activated', ({ id }) => { state.activeSceneId = id; emit('scenes'); });
  socket.on('scenes:list', (list) => { state.scenes = list; state.activeSceneId = list.find(s => s.active)?.id ?? state.activeSceneId; emit('scenes'); });
  socket.on('scene:preload', ({ url }) => { const img = new Image(); img.src = url; });

  const sceneMap = (key) => state.scene ? state.scene[key] : null;
  socket.on('token:create', (t) => { if (sceneMap('tokens') && t.scene_id === state.scene.scene.id) { state.scene.tokens.set(t.id, t); emit('token', t); } });
  socket.on('token:update', (t) => { if (sceneMap('tokens') && t.scene_id === state.scene.scene.id) { state.scene.tokens.set(t.id, t); emit('token', t); } });
  socket.on('token:delete', ({ id }) => { if (sceneMap('tokens')) { state.scene.tokens.delete(id); state.selected.delete(id); state.targets.delete(id); emit('token:delete', id); emit('targets'); } });
  socket.on('wall:create', (w) => { if (sceneMap('walls')) { state.scene.walls.set(w.id, w); emit('walls'); } });
  socket.on('wall:update', (w) => { if (sceneMap('walls')) { state.scene.walls.set(w.id, w); emit('walls'); } });
  socket.on('wall:delete', ({ id }) => { if (sceneMap('walls')) { state.scene.walls.delete(id); emit('walls'); } });
  socket.on('light:create', (l) => { if (sceneMap('lights')) { state.scene.lights.set(l.id, l); emit('lights'); } });
  socket.on('light:delete', ({ id }) => { if (sceneMap('lights')) { state.scene.lights.delete(id); emit('lights'); } });
  socket.on('fog:add', ({ shapes }) => { if (state.scene) { state.scene.fog.shapes.push(...shapes); emit('fog'); } });
  socket.on('fog:set', ({ shapes }) => { if (state.scene) { state.scene.fog.shapes = shapes; emit('fog'); } });
  socket.on('map:ping', (p) => emit('ping', p));
  socket.on('map:pan', (p) => emit('pan', p));

  // --- Chat ---
  socket.on('chat:message', (m) => { state.chat.push(m); if (state.chat.length > 400) state.chat.shift(); emit('chat:message', m); });
  socket.on('chat:update', (m) => { const i = state.chat.findIndex(x => x.id === m.id); if (i >= 0) state.chat[i] = m; emit('chat:update', m); });
  socket.on('chat:delete', ({ id }) => { state.chat = state.chat.filter(m => m.id !== id); emit('chat:delete', id); });
  socket.on('chat:cleared', () => { state.chat = []; emit('chat:reset'); });

  // --- Combate, diário, mídia ---
  socket.on('combat:update', (c) => { state.combat = c; emit('combat'); });
  socket.on('journal:update', (j) => { state.journal.set(j.id, j); emit('journal'); emit(`journal:${j.id}`, j); });
  socket.on('journal:delete', ({ id }) => { state.journal.delete(id); emit('journal'); emit(`journal:${id}`, null); });
  socket.on('playlists:update', (p) => { state.playlists = p; emit('playlists'); });
  socket.on('audio:state', (a) => { state.audio = a; emit('audio'); });
  socket.on('audio:sfx', (s) => emit('sfx', s));
  socket.on('handout:show', (h) => { state.handout = h; emit('handout'); });
  socket.on('handout:close', () => { state.handout = null; emit('handout'); });
  socket.on('rolltables:update', (t) => { state.rolltables = t; emit('tables'); });

  // --- Sistema ---
  socket.on('system:reload', async () => {
    await loadSystem();
    emit('system');
    if (isGM()) ui.toast('Regras recarregadas dos arquivos JSON.', 'ok');
  });
  socket.on('sys:reaction', (p) => emit('sys:reaction', p));
  socket.on('sys:reactionClosed', (p) => emit('sys:reactionClosed', p));
  socket.on('sys:settings', (p) => emit('sys:settings', p));
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loading').innerHTML = '<p>Não foi possível carregar a mesa. Recarregue a página.</p>';
});
