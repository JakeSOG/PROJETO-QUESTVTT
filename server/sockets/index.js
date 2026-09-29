// Liga o Socket.IO: autenticação por cookie, estado inicial e registro dos módulos.
// Padrão de eventos: "modulo:acao" (chat:send, token:move, combat:next...).
const modules = [
  require('./users'),
  require('./chat'),
  require('./scenes'),
  require('./actors'),
  require('./combat'),
  require('./media'),
  require('./journal')
];

// Registra um handler com tratamento de erro, checagem de papel e resposta (ack).
function makeOn(socket) {
  return function on(event, handler, opts = {}) {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const user = socket.data.user;
      try {
        if (!user || user.status !== 'approved') return reply({ error: 'Não autorizado.' });
        if (opts.gm && user.role !== 'gm') return reply({ error: 'Apenas o Mestre pode fazer isso.' });
        if (opts.player && user.role === 'spectator') return reply({ error: 'Espectadores apenas assistem.' });
        const result = await handler(payload || {}, user);
        reply(result === undefined ? { ok: true } : result);
      } catch (err) {
        if (err && err.userMessage) return reply({ error: err.userMessage });
        console.error(`✖ Erro em ${event}:`, err);
        reply({ error: 'Erro interno no servidor.' });
      }
    });
  };
}

// Erro com mensagem amigável para o jogador.
function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  throw e;
}

function setupSockets(ctx) {
  const { io, auth, store, world, rt, config, system } = ctx;
  ctx.fail = fail;

  io.use((socket, next) => {
    const cookies = auth.parseCookies(socket.handshake.headers.cookie);
    const user = auth.userFromToken(cookies[auth.COOKIE]);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const on = makeOn(socket);

    if (user.status !== 'approved') {
      socket.emit('auth:pending', { name: user.name });
      world.broadcastUsers();
      rt.emitGM('users:pending', { id: user.id, name: user.name });
      socket.on('disconnect', () => world.broadcastUsers());
      return;
    }

    // Estado inicial completo, já filtrado por permissão.
    socket.emit('world:state', buildState(ctx, socket));
    world.sendSceneTo(socket);
    world.broadcastUsers();

    for (const mod of modules) mod.register({ ...ctx, socket, on, user: () => socket.data.user });
    if (ctx.engine && ctx.engine.registerSocket) ctx.engine.registerSocket({ ...ctx, socket, on });

    socket.on('disconnect', () => world.broadcastUsers());
  });
}

function buildState(ctx, socket) {
  const { store, world, config, rt } = ctx;
  const user = socket.data.user;
  const gm = world.isGM(user);
  return {
    user: { id: user.id, name: user.name, role: user.role, color: user.color },
    tableName: config.tableName,
    users: gm ? world.usersState() : world.usersState().filter(u => u.status === 'approved').map(({ id, name, role, color, online }) => ({ id, name, role, color, online })),
    actors: store.actors.list().map(a => world.actorView(a, user)).filter(Boolean),
    scenes: gm ? store.scenes.list() : [],
    activeSceneId: store.scenes.active()?.id ?? null,
    chat: store.chat.recent(config.chatHistory).map(m => world.messageView(m, user)).filter(Boolean),
    combat: world.combatState(user),
    journal: store.journal.list().map(e => world.journalView(e, user)).filter(Boolean),
    playlists: gm ? store.playlists.list() : [],
    audio: ctx.audioState ? ctx.audioState() : null,
    rolltables: store.rolltables.list(),
    handout: ctx.currentHandout ? ctx.currentHandout(user) : null
  };
}

module.exports = { setupSockets, fail };
