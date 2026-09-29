// Ajudantes de tempo real: quem está online e como enviar dados filtrados por permissão.
function createRealtime(io) {
  const rt = {
    io,
    sockets() {
      return [...io.of('/').sockets.values()].filter(s => s.data.user);
    },
    onlineUsers() {
      const seen = new Map();
      for (const s of rt.sockets()) {
        const u = s.data.user;
        if (u.status !== 'approved') continue;
        seen.set(u.id, { id: u.id, name: u.name, role: u.role, color: u.color });
      }
      return [...seen.values()];
    },
    isOnline(userId) {
      return rt.sockets().some(s => s.data.user.id === userId);
    },
    // Envia para todos os aprovados.
    emitAll(event, payload) {
      for (const s of rt.sockets()) if (s.data.user.status === 'approved') s.emit(event, payload);
    },
    emitGM(event, payload) {
      for (const s of rt.sockets()) if (s.data.user.role === 'gm') s.emit(event, payload);
    },
    emitUser(userId, event, payload) {
      for (const s of rt.sockets()) if (s.data.user.id === userId) s.emit(event, payload);
    },
    // fn(user, socket) devolve o payload daquele usuário, ou undefined para não enviar.
    emitFiltered(event, fn) {
      for (const s of rt.sockets()) {
        if (s.data.user.status !== 'approved') continue;
        const p = fn(s.data.user, s);
        if (p !== undefined) s.emit(event, p);
      }
    },
    // Atualiza o objeto "user" guardado nos sockets de um usuário (após aprovação, troca de cor...).
    refreshUser(user) {
      for (const s of rt.sockets()) if (s.data.user.id === user.id) s.data.user = user;
    }
  };
  return rt;
}

module.exports = { createRealtime };
