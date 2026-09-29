// Rastreador de combate. O núcleo cuida de rodadas, lados e ordem;
// o sistema (engine) aplica as regras: PA, estados, dano contínuo, iniciativa.
function register(ctx) {
  const { on, store, world, rt, fail, socket } = ctx;
  const engine = () => ctx.engine;

  function current() {
    const c = store.combat.active();
    if (!c) fail('Nenhum combate ativo.');
    return c;
  }

  function sideOf(token, actor) {
    if (engine().combatSide) return engine().combatSide(token, actor);
    return token.data.disposition === 'hunter' ? 'hunters' : 'creatures';
  }

  function addTokens(combat, tokenIds) {
    const existing = new Set(store.combat.combatants(combat.id).map(c => c.token_id));
    let added = 0;
    for (const id of tokenIds) {
      const token = store.tokens.get(Number(id));
      if (!token || existing.has(token.id) || !token.actor_id) continue;
      if (token.data.disposition === 'corpse') continue;
      const actor = store.actors.get(token.actor_id);
      if (!actor) continue;
      const cb = store.combat.addCombatant(combat.id, token.id, actor.id, { side: sideOf(token, actor), done: false });
      if (engine().onCombatantAdded) engine().onCombatantAdded(combat, cb, actor);
      added++;
    }
    return added;
  }

  on('combat:start', ({ tokenIds }) => {
    if (store.combat.active()) fail('Já existe um combate ativo.');
    const sceneId = world.viewedSceneId(socket);
    if (!sceneId) fail('Nenhuma cena.');
    const sides = ctx.system.rules.combat?.initiative?.sides || ['hunters', 'creatures'];
    const combat = store.combat.create(sceneId, { round: 0, side: null, firstSide: sides[0], sides, started: false, log: [] });
    const ids = Array.isArray(tokenIds) && tokenIds.length ? tokenIds : store.tokens.list(sceneId).map(t => t.id);
    addTokens(combat, ids);
    if (engine().onCombatCreate) engine().onCombatCreate(store.combat.get(combat.id));
    world.broadcastCombat();
    world.systemMessage('⚔ <b>O combate começa.</b>');
  }, { gm: true });

  on('combat:add', ({ tokenIds }) => {
    const combat = current();
    addTokens(combat, tokenIds || []);
    world.broadcastCombat();
  }, { gm: true });

  on('combat:remove', ({ id }) => {
    const combat = current();
    const cb = store.combat.getCombatant(Number(id));
    if (!cb || cb.combat_id !== combat.id) return;
    store.combat.removeCombatant(cb.id);
    world.broadcastCombat();
  }, { gm: true });

  on('combat:setSide', ({ id, side }) => {
    const combat = current();
    const cb = store.combat.getCombatant(Number(id));
    if (!cb || cb.combat_id !== combat.id) return;
    if (!combat.data.sides.includes(side)) fail('Lado inválido.');
    store.combat.updateCombatant(cb.id, { side });
    world.broadcastCombat();
  }, { gm: true });

  // Quem começa: rolagem de iniciativa do sistema, ou escolha direta (surpresa).
  on('combat:initiative', async ({ mode, actorId }, user) => {
    const combat = current();
    let first = combat.data.sides[0];
    if (mode === 'roll') {
      if (!engine().rollInitiative) fail('O sistema não define rolagem de iniciativa.');
      first = await engine().rollInitiative(combat, { actorId, user });
    } else if (combat.data.sides.includes(mode)) {
      first = mode;
      world.systemMessage(`⚔ Surpresa! <b>${mode === 'hunters' ? 'Os caçadores' : 'As criaturas'}</b> agem primeiro.`);
    }
    store.combat.update(combat.id, { firstSide: first });
    world.broadcastCombat();
  }, { gm: true });

  on('combat:begin', () => {
    const combat = current();
    if (combat.data.started) fail('O combate já começou.');
    const updated = store.combat.update(combat.id, { started: true, round: 1, side: combat.data.firstSide });
    if (engine().onSideStart) engine().onSideStart(updated, updated.data.side);
    world.broadcastCombat();
    world.systemMessage(`⚔ <b>Rodada 1</b> — turno ${sideLabel(updated.data.side)}.`);
  }, { gm: true });

  function sideLabel(side) {
    return side === 'hunters' ? 'dos <b>caçadores</b>' : 'das <b>criaturas</b>';
  }

  // Avança para o próximo lado (e para a próxima rodada quando volta ao primeiro).
  on('combat:next', () => {
    const combat = current();
    if (!combat.data.started) fail('Defina a iniciativa e comece o combate.');
    const sides = combat.data.sides;
    if (engine().onSideEnd) engine().onSideEnd(combat, combat.data.side);
    const idx = sides.indexOf(combat.data.side);
    const nextSide = sides[(idx + 1) % sides.length];
    const round = nextSide === combat.data.firstSide ? combat.data.round + 1 : combat.data.round;
    for (const cb of store.combat.combatants(combat.id)) store.combat.updateCombatant(cb.id, { done: false });
    const updated = store.combat.update(combat.id, { side: nextSide, round, activeCombatantId: null });
    if (engine().onSideStart) engine().onSideStart(updated, nextSide);
    world.broadcastCombat();
    world.systemMessage(`⚔ <b>Rodada ${round}</b> — turno ${sideLabel(nextSide)}.`);
  }, { gm: true });

  // Destaca o combatente que está agindo agora (Mestre ou dono do token).
  on('combat:activate', ({ id }, user) => {
    const combat = current();
    const cb = store.combat.getCombatant(Number(id));
    if (!cb || cb.combat_id !== combat.id) fail('Combatente inválido.');
    const actor = store.actors.get(cb.actor_id);
    if (!world.canControlActor(user, actor)) fail('Você não controla este combatente.');
    store.combat.update(combat.id, { activeCombatantId: cb.id });
    world.broadcastCombat();
  }, { player: true });

  // Jogador marca que terminou suas ações neste turno.
  on('combat:done', ({ id, done }, user) => {
    const combat = current();
    const cb = store.combat.getCombatant(Number(id));
    if (!cb || cb.combat_id !== combat.id) fail('Combatente inválido.');
    const actor = store.actors.get(cb.actor_id);
    if (!world.canControlActor(user, actor)) fail('Você não controla este combatente.');
    store.combat.updateCombatant(cb.id, { done: done !== false });
    world.broadcastCombat();
  }, { player: true });

  on('combat:end', () => {
    const combat = current();
    if (engine().onCombatEnd) engine().onCombatEnd(combat);
    store.combat.end(combat.id);
    world.broadcastCombat();
    world.systemMessage('⚔ <b>O combate terminou.</b>');
  }, { gm: true });
}

module.exports = { register };
