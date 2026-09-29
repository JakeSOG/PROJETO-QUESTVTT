// Fichas (atores): criação, edição com validação do sistema, vínculo com jogadores, import/export.
function register(ctx) {
  const { on, store, world, fail, socket } = ctx;
  const engine = () => ctx.engine;
  const isGM = (u) => u.role === 'gm';

  function canEdit(user, actor) {
    return world.canControlActor(user, actor);
  }

  on('actor:create', ({ type, name, data, ownerId }, user) => {
    const types = Object.keys(ctx.system.manifest.actorTypes || {});
    if (!types.includes(type)) fail('Tipo de ficha inválido.');
    if (!isGM(user)) {
      if (type !== ctx.system.manifest.playerActorType) fail('Jogadores só criam o próprio caçador.');
      if (store.actors.list().some(a => a.owner_id === user.id)) fail('Você já tem um caçador. Peça ao Mestre para criar outro.');
    }
    const base = engine().defaultActorData(type, data || {});
    const actor = store.actors.create({
      type,
      name: String(name || (type === 'hunter' ? 'Novo Caçador' : 'Nova Criatura')).slice(0, 80),
      img: null,
      owner_id: isGM(user) ? (ownerId ? Number(ownerId) : null) : user.id,
      data: base
    });
    world.broadcastActor(actor);
    return { actor: world.actorView(actor, user) };
  }, { player: true });

  on('actor:update', ({ id, name, img, data }, user) => {
    const actor = store.actors.get(Number(id));
    if (!actor) fail('Ficha não encontrada.');
    if (!canEdit(user, actor)) fail('Você só pode editar a sua própria ficha.');
    const patch = {};
    if (name !== undefined) patch.name = String(name).slice(0, 80);
    if (img !== undefined) patch.img = img ? String(img).slice(0, 300) : null;
    if (data !== undefined) {
      const clean = engine().sanitizeUpdate(actor, data, user);
      if (clean && typeof clean === 'object' && Object.keys(clean).length) patch.data = clean;
    }
    const updated = engine().applyActorUpdate ? engine().applyActorUpdate(actor, patch, user) : store.actors.update(actor.id, patch);
    // Nome e imagem do token acompanham a ficha.
    if (patch.name !== undefined || patch.img !== undefined) {
      for (const t of store.db.prepare('SELECT id FROM tokens WHERE actor_id = ?').all(actor.id)) {
        const tk = store.tokens.update(t.id, { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.img !== undefined ? { img: patch.img } : {}) });
        world.broadcastToken(tk);
      }
    }
    return { actor: world.actorView(updated, user) };
  }, { player: true });

  on('actor:delete', ({ id }) => {
    const actor = store.actors.get(Number(id));
    if (!actor) return;
    const tokens = store.db.prepare('SELECT id, scene_id FROM tokens WHERE actor_id = ?').all(actor.id);
    store.actors.remove(actor.id);
    for (const t of tokens) world.emitScene(t.scene_id, 'token:delete', { id: t.id });
    world.broadcastActorDelete(actor.id);
  }, { gm: true });

  // Vincula uma ficha a um jogador (dono).
  on('actor:link', ({ id, userId }) => {
    const actor = store.actors.get(Number(id));
    if (!actor) fail('Ficha não encontrada.');
    const owner = userId ? store.users.get(Number(userId)) : null;
    if (userId && !owner) fail('Jogador não encontrado.');
    const updated = store.actors.update(actor.id, { owner_id: owner ? owner.id : null });
    // Todos recebem a nova visão (o antigo dono perde acesso completo, o novo ganha).
    world.broadcastActor(updated);
  }, { gm: true });

  on('actor:duplicate', ({ id }) => {
    const actor = store.actors.get(Number(id));
    if (!actor) fail('Ficha não encontrada.');
    const copy = store.actors.create({ type: actor.type, name: `${actor.name} (cópia)`, img: actor.img, owner_id: null, data: { ...actor.data, sceneCopy: false } });
    world.broadcastActor(copy);
  }, { gm: true });

  on('actor:export', ({ id }, user) => {
    const actor = store.actors.get(Number(id));
    if (!actor || !canEdit(user, actor)) fail('Sem acesso a esta ficha.');
    return { export: { questvtt: 'actor', system: ctx.system.id, version: 1, type: actor.type, name: actor.name, img: actor.img, data: actor.data } };
  }, { player: true });

  on('actor:import', ({ json, id }, user) => {
    let data = json;
    if (typeof json === 'string') { try { data = JSON.parse(json); } catch { fail('JSON inválido.'); } }
    if (!data || data.questvtt !== 'actor') fail('Arquivo não é uma ficha do QuestVTT.');
    if (data.system && data.system !== ctx.system.id) fail(`Ficha de outro sistema (${data.system}).`);
    const clean = engine().defaultActorData(data.type, data.data || {});
    if (id) {
      // Importar por cima de uma ficha existente.
      const actor = store.actors.get(Number(id));
      if (!actor || !canEdit(user, actor)) fail('Sem acesso a esta ficha.');
      if (actor.type !== data.type) fail('Tipo de ficha diferente.');
      const updated = store.actors.update(actor.id, { name: data.name, img: data.img, data: clean }, true);
      world.broadcastActor(updated);
      return { actor: world.actorView(updated, user) };
    }
    if (!isGM(user)) fail('Apenas o Mestre importa fichas novas. Importe por cima da sua ficha.');
    const actor = store.actors.create({ type: data.type, name: String(data.name || 'Importado').slice(0, 80), img: data.img || null, owner_id: null, data: clean });
    world.broadcastActor(actor);
    return { actor };
  }, { player: true });

  // Arrastar do bestiário para o mapa: cria uma criatura própria daquele token.
  on('actor:spawn', ({ pack, ref, x, y, hidden }) => {
    const entry = ctx.system.index[pack]?.[ref];
    if (!entry) fail('Entrada do compêndio não encontrada.');
    const sceneId = world.viewedSceneId(socket);
    if (!sceneId) fail('Nenhuma cena.');
    const data = engine().creatureFromCompendium(entry, { sceneId });
    const sameName = store.tokens.list(sceneId).filter(t => (t.data.name || '').startsWith(entry.name)).length;
    const name = sameName ? `${entry.name} ${sameName + 1}` : entry.name;
    const actor = store.actors.create({ type: 'creature', name, img: entry.img || null, owner_id: null, data: { ...data, sceneCopy: true } });
    world.broadcastActor(actor);
    const scene = store.scenes.get(sceneId);
    const gs = scene.data.grid.size;
    const size = data.tokenSize || 1;
    const token = store.tokens.create({ scene_id: sceneId, actor_id: actor.id, data: {
      x: Math.floor(Number(x) / gs) * gs, y: Math.floor(Number(y) / gs) * gs, size, name, img: entry.img || null,
      hidden: !!hidden, showName: 'hover', disposition: 'creature', vision: { enabled: false, range: null, dim: 0 }, light: { radius: 0, color: '#ffc36b' }, rotation: 0
    } });
    world.emitScene(sceneId, 'token:create', (u) => world.tokenView(token, u));
    return { token, actor };
  }, { gm: true });
}

module.exports = { register };
