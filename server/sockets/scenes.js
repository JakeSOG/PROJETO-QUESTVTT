// Cenas, tokens, paredes, luzes e névoa de guerra.
const SCENE_DEFAULTS = {
  background: null,
  bgColor: '#0b0908',
  width: 2800,
  height: 2100,
  grid: { size: 70, offsetX: 0, offsetY: 0, color: '#000000', alpha: 0.3, show: true, units: 1.5, unitName: 'm' },
  vision: true,        // paredes e luzes definem o que os jogadores veem
  darkness: 0.92,      // opacidade da escuridão para os jogadores (0 = dia claro)
  fog: true,           // névoa de guerra manual
  gmDarkness: 0.45     // quanto o Mestre vê da escuridão (só visual)
};

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Interseção de segmentos (para impedir que jogadores atravessem paredes).
function segmentsIntersect(a, b, c, d) {
  const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function sanitizeTokenData(d, gm) {
  const out = {};
  if (d.x !== undefined) out.x = num(d.x);
  if (d.y !== undefined) out.y = num(d.y);
  if (d.size !== undefined) out.size = clamp(num(d.size, 1), 0.25, 12);
  if (d.name !== undefined) out.name = String(d.name).slice(0, 60);
  if (d.img !== undefined) out.img = d.img ? String(d.img).slice(0, 300) : null;
  if (d.rotation !== undefined) out.rotation = num(d.rotation) % 360;
  if (gm) {
    if (d.hidden !== undefined) out.hidden = !!d.hidden;
    if (d.showName !== undefined) out.showName = ['all', 'hover', 'gm'].includes(d.showName) ? d.showName : 'hover';
    if (d.disposition !== undefined) out.disposition = ['hunter', 'creature', 'neutral', 'corpse'].includes(d.disposition) ? d.disposition : 'neutral';
    if (d.vision !== undefined) out.vision = { enabled: !!d.vision.enabled, range: d.vision.range == null ? null : clamp(num(d.vision.range), 0, 999), dim: clamp(num(d.vision.dim, 1.5), 0, 999) };
    if (d.light !== undefined) out.light = { radius: clamp(num(d.light.radius), 0, 999), color: /^#[0-9a-f]{6}$/i.test(d.light.color || '') ? d.light.color : '#ffc36b' };
    if (d.note !== undefined) out.note = String(d.note).slice(0, 2000);
    if (d.ecos !== undefined) out.ecos = Math.max(0, Math.floor(num(d.ecos)));
  }
  return out;
}

function register(ctx) {
  const { on, store, world, rt, fail, socket } = ctx;
  const isGM = (u) => u.role === 'gm';

  function broadcastSceneList() {
    rt.emitGM('scenes:list', store.scenes.list());
  }

  // ---------------- Cenas ----------------
  on('scene:create', ({ name, data }) => {
    const scene = store.scenes.create({ name: String(name || 'Nova cena').slice(0, 80), data: { ...SCENE_DEFAULTS, ...(data || {}), grid: { ...SCENE_DEFAULTS.grid, ...(data?.grid || {}) } } });
    if (!store.scenes.active()) { store.scenes.activate(scene.id); world.reloadSceneForViewers(null); }
    broadcastSceneList();
    return { scene };
  }, { gm: true });

  on('scene:update', ({ id, name, data }) => {
    const cur = store.scenes.get(Number(id));
    if (!cur) fail('Cena não encontrada.');
    const patch = {};
    if (data) {
      const d = {};
      if (data.background !== undefined) d.background = data.background ? String(data.background).slice(0, 300) : null;
      if (data.bgColor !== undefined) d.bgColor = /^#[0-9a-f]{6}$/i.test(data.bgColor) ? data.bgColor : '#0b0908';
      if (data.width !== undefined) d.width = clamp(num(data.width, 2000), 200, 20000);
      if (data.height !== undefined) d.height = clamp(num(data.height, 2000), 200, 20000);
      if (data.vision !== undefined) d.vision = !!data.vision;
      if (data.fog !== undefined) d.fog = !!data.fog;
      if (data.darkness !== undefined) d.darkness = clamp(num(data.darkness, 0.9), 0, 1);
      if (data.gmDarkness !== undefined) d.gmDarkness = clamp(num(data.gmDarkness, 0.45), 0, 1);
      if (data.grid) {
        const g = data.grid;
        d.grid = {};
        if (g.size !== undefined) d.grid.size = clamp(num(g.size, 70), 10, 400);
        if (g.offsetX !== undefined) d.grid.offsetX = num(g.offsetX);
        if (g.offsetY !== undefined) d.grid.offsetY = num(g.offsetY);
        if (g.color !== undefined) d.grid.color = /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#000000';
        if (g.alpha !== undefined) d.grid.alpha = clamp(num(g.alpha, 0.3), 0, 1);
        if (g.show !== undefined) d.grid.show = !!g.show;
        if (g.units !== undefined) d.grid.units = clamp(num(g.units, 1.5), 0.1, 100);
        if (g.unitName !== undefined) d.grid.unitName = String(g.unitName).slice(0, 8);
      }
      patch.data = d;
    }
    if (name !== undefined) patch.name = name;
    const scene = store.scenes.update(cur.id, patch);
    broadcastSceneList();
    world.emitScene(scene.id, 'scene:updated', scene);
    return { scene };
  }, { gm: true });

  on('scene:delete', ({ id }) => {
    const scene = store.scenes.get(Number(id));
    if (!scene) fail('Cena não encontrada.');
    const wasActive = scene.active;
    store.scenes.remove(scene.id);
    if (wasActive) {
      const next = store.scenes.list()[0];
      if (next) store.scenes.activate(next.id);
    }
    for (const s of rt.sockets()) if (s.data.viewSceneId === scene.id) s.data.viewSceneId = null;
    broadcastSceneList();
    world.reloadSceneForViewers(null);
  }, { gm: true });

  // Troca a cena de TODOS com um clique.
  on('scene:activate', ({ id }) => {
    const scene = store.scenes.get(Number(id));
    if (!scene) fail('Cena não encontrada.');
    store.scenes.activate(scene.id);
    for (const s of rt.sockets()) if (isGM(s.data.user)) s.data.viewSceneId = null;
    broadcastSceneList();
    rt.emitAll('scene:activated', { id: scene.id });
    world.reloadSceneForViewers(null);
  }, { gm: true });

  // Mestre "espia" uma cena sem mudar a dos jogadores; os clientes pré-carregam o fundo.
  on('scene:view', ({ id }) => {
    const scene = store.scenes.get(Number(id));
    if (!scene) fail('Cena não encontrada.');
    socket.data.viewSceneId = scene.active ? null : scene.id;
    world.sendSceneTo(socket);
    if (scene.data.background) rt.emitAll('scene:preload', { url: scene.data.background });
  }, { gm: true });

  on('scene:export', ({ id }) => {
    const bundle = world.sceneBundle(Number(id), { role: 'gm' });
    if (!bundle) fail('Cena não encontrada.');
    return { export: {
      questvtt: 'scene', version: 1, name: bundle.scene.name, data: bundle.scene.data,
      tokens: bundle.tokens.map(t => ({ data: t.data })),
      walls: bundle.walls.map(w => w.data), lights: bundle.lights.map(l => l.data), fog: bundle.fog
    } };
  }, { gm: true });

  on('scene:import', ({ json }) => {
    let data = json;
    if (typeof json === 'string') { try { data = JSON.parse(json); } catch { fail('JSON inválido.'); } }
    if (!data || data.questvtt !== 'scene') fail('Arquivo não é uma cena do QuestVTT.');
    const scene = store.scenes.create({ name: String(data.name || 'Cena importada').slice(0, 80), data: { ...SCENE_DEFAULTS, ...(data.data || {}) } });
    for (const w of data.walls || []) store.walls.create({ scene_id: scene.id, data: w });
    for (const l of data.lights || []) store.lights.create({ scene_id: scene.id, data: l });
    // Tokens importados ficam sem vínculo (as fichas são exportadas à parte).
    for (const t of data.tokens || []) store.tokens.create({ scene_id: scene.id, actor_id: null, data: t.data });
    if (data.fog) store.fog.set(scene.id, data.fog);
    broadcastSceneList();
    return { scene };
  }, { gm: true });

  // ---------------- Tokens ----------------
  on('token:create', ({ actorId, x, y, data }, user) => {
    const sceneId = world.viewedSceneId(socket);
    if (!sceneId) fail('Nenhuma cena ativa.');
    const actor = actorId ? store.actors.get(Number(actorId)) : null;
    if (!isGM(user)) {
      if (!actor || actor.owner_id !== user.id) fail('Você só pode colocar o seu próprio caçador.');
      if (store.tokens.list(sceneId).some(t => t.actor_id === actor.id)) fail('Seu caçador já está nesta cena.');
    }
    const scene = store.scenes.get(sceneId);
    const gs = scene.data.grid.size;
    const hunter = actor && actor.type === 'hunter';
    const tokenData = {
      x: Math.round(num(x) / gs) * gs + (scene.data.grid.offsetX % gs),
      y: Math.round(num(y) / gs) * gs + (scene.data.grid.offsetY % gs),
      size: actor?.data?.tokenSize || 1,
      name: actor ? actor.name : 'Token',
      img: actor ? actor.img : null,
      hidden: false,
      showName: hunter ? 'all' : 'hover',
      disposition: hunter ? 'hunter' : (actor ? 'creature' : 'neutral'),
      vision: { enabled: hunter, range: null, dim: 1.5 },
      light: { radius: 0, color: '#ffc36b' },
      rotation: 0,
      ...(isGM(user) ? sanitizeTokenData(data || {}, true) : {})
    };
    const token = store.tokens.create({ scene_id: sceneId, actor_id: actor ? actor.id : null, data: tokenData });
    world.emitScene(sceneId, 'token:create', (u) => world.tokenView(token, u));
    return { token };
  }, { player: true });

  on('token:update', ({ id, data }, user) => {
    const token = store.tokens.get(Number(id));
    if (!token) fail('Token não encontrado.');
    if (!isGM(user) && !world.canMoveToken(user, token)) fail('Sem permissão para este token.');
    const clean = sanitizeTokenData(data || {}, isGM(user));
    if (!isGM(user)) { delete clean.x; delete clean.y; } // posição só via token:move
    const updated = store.tokens.update(token.id, clean);
    world.broadcastToken(updated);
    return { token: updated };
  }, { player: true });

  // Movimento: o cliente move na hora (otimista) e o servidor confirma ou devolve.
  on('token:move', ({ id, x, y }, user) => {
    const token = store.tokens.get(Number(id));
    if (!token) fail('Token não encontrado.');
    if (!world.canMoveToken(user, token)) return { error: 'Você não controla este token.', token };
    const nx = num(x, token.data.x), ny = num(y, token.data.y);
    if (!isGM(user)) {
      const scene = store.scenes.get(token.scene_id);
      const half = (scene.data.grid.size * (token.data.size || 1)) / 2;
      const a = { x: token.data.x + half, y: token.data.y + half };
      const b = { x: nx + half, y: ny + half };
      const blocked = store.walls.list(token.scene_id).some(w => !(w.data.door && w.data.open) && w.data.blocksMove !== false &&
        segmentsIntersect(a, b, { x: w.data.x1, y: w.data.y1 }, { x: w.data.x2, y: w.data.y2 }));
      if (blocked) return { error: 'Uma parede bloqueia o caminho.', token };
      if (ctx.engine && ctx.engine.canMove) {
        const reason = ctx.engine.canMove(token);
        if (reason) return { error: reason, token };
      }
    }
    const updated = store.tokens.update(token.id, { x: nx, y: ny });
    world.emitScene(token.scene_id, 'token:update', (u) => world.tokenView(updated, u));
    return { token: updated };
  }, { player: true });

  on('token:delete', ({ id }) => {
    const token = store.tokens.get(Number(id));
    if (!token) return;
    store.tokens.remove(token.id);
    world.emitScene(token.scene_id, 'token:delete', { id: token.id });
    // Criaturas "de cena" (sem dono, criadas do bestiário) somem junto com o token.
    if (token.actor_id) {
      const actor = store.actors.get(token.actor_id);
      if (actor && actor.type !== 'hunter' && actor.data.sceneCopy && !store.db.prepare('SELECT 1 FROM tokens WHERE actor_id = ?').get(actor.id)) {
        store.actors.remove(actor.id);
        world.broadcastActorDelete(actor.id);
      }
    }
  }, { gm: true });

  // ---------------- Paredes ----------------
  on('wall:create', ({ x1, y1, x2, y2, door }) => {
    const sceneId = world.viewedSceneId(socket);
    if (!sceneId) fail('Nenhuma cena.');
    const wall = store.walls.create({ scene_id: sceneId, data: { x1: num(x1), y1: num(y1), x2: num(x2), y2: num(y2), door: !!door, open: false } });
    world.emitScene(sceneId, 'wall:create', wall);
    return { wall };
  }, { gm: true });

  on('wall:update', ({ id, data }) => {
    const wall = store.walls.get(Number(id));
    if (!wall) fail('Parede não encontrada.');
    const d = {};
    for (const k of ['x1', 'y1', 'x2', 'y2']) if (data[k] !== undefined) d[k] = num(data[k]);
    if (data.door !== undefined) d.door = !!data.door;
    if (data.open !== undefined) d.open = !!data.open;
    if (data.blocksMove !== undefined) d.blocksMove = !!data.blocksMove;
    const updated = store.walls.update(wall.id, d);
    world.emitScene(wall.scene_id, 'wall:update', updated);
  }, { gm: true });

  // Jogadores podem abrir e fechar portas.
  on('wall:door', ({ id, open }) => {
    const wall = store.walls.get(Number(id));
    if (!wall || !wall.data.door) fail('Não é uma porta.');
    if (wall.data.locked && socket.data.user.role !== 'gm') fail('A porta está trancada.');
    const updated = store.walls.update(wall.id, { open: !!open });
    world.emitScene(wall.scene_id, 'wall:update', updated);
  }, { player: true });

  on('wall:delete', ({ id }) => {
    const wall = store.walls.get(Number(id));
    if (!wall) return;
    store.walls.remove(wall.id);
    world.emitScene(wall.scene_id, 'wall:delete', { id: wall.id });
  }, { gm: true });

  on('wall:clear', () => {
    const sceneId = world.viewedSceneId(socket);
    store.walls.clear(sceneId);
    world.reloadSceneForViewers(sceneId);
  }, { gm: true });

  // ---------------- Luzes ----------------
  on('light:create', ({ x, y, radius, color, dim }) => {
    const sceneId = world.viewedSceneId(socket);
    if (!sceneId) fail('Nenhuma cena.');
    const light = store.lights.create({ scene_id: sceneId, data: {
      x: num(x), y: num(y), radius: clamp(num(radius, 6), 0.5, 200), dim: clamp(num(dim, 0), 0, 400),
      color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#ffb85c', flicker: true, hidden: false
    } });
    world.emitScene(sceneId, 'light:create', light);
    return { light };
  }, { gm: true });

  on('light:update', ({ id, data }) => {
    const light = store.lights.get(Number(id));
    if (!light) fail('Luz não encontrada.');
    const d = {};
    if (data.x !== undefined) d.x = num(data.x);
    if (data.y !== undefined) d.y = num(data.y);
    if (data.radius !== undefined) d.radius = clamp(num(data.radius, 6), 0.5, 200);
    if (data.dim !== undefined) d.dim = clamp(num(data.dim), 0, 400);
    if (data.color !== undefined && /^#[0-9a-f]{6}$/i.test(data.color)) d.color = data.color;
    if (data.flicker !== undefined) d.flicker = !!data.flicker;
    if (data.hidden !== undefined) d.hidden = !!data.hidden;
    if (data.off !== undefined) d.off = !!data.off;
    const updated = store.lights.update(light.id, d);
    world.reloadSceneForViewers(light.scene_id);
    return { light: updated };
  }, { gm: true });

  on('light:delete', ({ id }) => {
    const light = store.lights.get(Number(id));
    if (!light) return;
    store.lights.remove(light.id);
    world.emitScene(light.scene_id, 'light:delete', { id: light.id });
  }, { gm: true });

  // ---------------- Névoa de guerra ----------------
  // shape: { op: 'reveal'|'hide', type: 'circle'|'rect'|'poly', x, y, r, w, h, points }
  on('fog:reveal', ({ shapes }) => {
    const sceneId = world.viewedSceneId(socket);
    if (!sceneId) fail('Nenhuma cena.');
    const list = (Array.isArray(shapes) ? shapes : []).slice(0, 200).map(s => ({
      op: s.op === 'hide' ? 'hide' : 'reveal',
      type: ['circle', 'rect', 'poly'].includes(s.type) ? s.type : 'circle',
      x: num(s.x), y: num(s.y), r: clamp(num(s.r, 50), 1, 5000), w: num(s.w), h: num(s.h),
      points: Array.isArray(s.points) ? s.points.slice(0, 400).map(p => num(p)) : undefined
    }));
    const fog = store.fog.get(sceneId);
    fog.shapes = [...(fog.shapes || []), ...list].slice(-8000);
    store.fog.set(sceneId, fog);
    world.emitScene(sceneId, 'fog:add', { shapes: list });
  }, { gm: true });

  on('fog:reset', ({ mode }) => {
    const sceneId = world.viewedSceneId(socket);
    // mode 'reveal' = revelar tudo; senão, esconder tudo
    const shapes = mode === 'reveal' ? [{ op: 'reveal', type: 'rect', x: -99999, y: -99999, w: 199999, h: 199999 }] : [];
    store.fog.set(sceneId, { shapes });
    world.emitScene(sceneId, 'fog:set', { shapes });
  }, { gm: true });
}

module.exports = { register, SCENE_DEFAULTS, segmentsIntersect };
