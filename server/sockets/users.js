// Usuários: aprovação de jogadores pelo Mestre, papéis, cores, vínculo com fichas e "ping" no mapa.
function register(ctx) {
  const { on, store, world, rt, fail, socket } = ctx;

  // Mestre aprova / recusa / bane / muda papel de um usuário.
  on('users:set', ({ id, status, role, color }) => {
    const target = store.users.get(Number(id));
    if (!target) fail('Usuário não encontrado.');
    if (target.role === 'gm' && (role && role !== 'gm')) fail('Não é possível rebaixar o Mestre.');
    const fields = {};
    if (status && ['approved', 'pending', 'banned'].includes(status)) fields.status = status;
    if (role && ['player', 'spectator'].includes(role)) fields.role = role;
    if (color && /^#[0-9a-f]{6}$/i.test(color)) fields.color = color;
    const updated = store.users.update(target.id, fields);
    rt.refreshUser(updated);
    if (fields.status === 'approved') rt.emitUser(updated.id, 'auth:approved', {});
    if (fields.status === 'banned') {
      store.sessions.removeForUser(updated.id);
      for (const s of rt.sockets()) if (s.data.user.id === updated.id) s.disconnect(true);
    }
    world.broadcastUsers();
  }, { gm: true });

  on('users:delete', ({ id }) => {
    const target = store.users.get(Number(id));
    if (!target || target.role === 'gm') fail('Não é possível remover este usuário.');
    for (const s of rt.sockets()) if (s.data.user.id === target.id) s.disconnect(true);
    store.users.remove(target.id);
    world.broadcastUsers();
  }, { gm: true });

  // Jogador escolhe a própria cor.
  on('users:color', ({ color }, user) => {
    if (!/^#[0-9a-f]{6}$/i.test(color || '')) fail('Cor inválida.');
    const updated = store.users.update(user.id, { color });
    rt.refreshUser(updated);
    world.broadcastUsers();
  });

  // Ping: destaca um ponto no mapa para todos que veem a cena.
  on('map:ping', ({ x, y }, user) => {
    const sceneId = world.viewedSceneId(socket);
    if (!sceneId) return;
    world.emitScene(sceneId, 'map:ping', { x: Number(x) || 0, y: Number(y) || 0, color: user.color, name: user.name });
  }, { player: true });

  // Mestre força todos a olharem para um ponto.
  on('map:pan', ({ x, y }) => {
    const sceneId = world.viewedSceneId(socket);
    world.emitScene(sceneId, 'map:pan', { x: Number(x) || 0, y: Number(y) || 0 });
  }, { gm: true });

  // Recarregar regras manualmente (além do recarregamento automático).
  on('rules:reload', () => {
    const res = ctx.system.reload();
    rt.emitAll('system:reload', {});
    return res.ok ? { ok: true } : { error: 'Erros: ' + res.errors.join('; ') };
  }, { gm: true });
}

module.exports = { register };
