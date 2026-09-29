// Diário: páginas de lore, notas ocultas do Mestre e notas compartilhadas.
// visibility: 'gm' (só Mestre) | 'all' (todos) | 'users' (jogadores escolhidos)
// editable: jogadores com acesso podem editar (notas compartilhadas)
function register(ctx) {
  const { on, store, world, rt, fail } = ctx;

  function broadcast(entry, removedFor = true) {
    rt.emitFiltered('journal:update', (u) => {
      const view = world.journalView(entry, u);
      if (view) return view;
      return undefined;
    });
    // Quem perdeu acesso recebe a remoção.
    if (removedFor) rt.emitFiltered('journal:delete', (u) => world.journalVisible(entry, u) ? undefined : { id: entry.id });
  }

  on('journal:create', ({ title, content, folder, visibility }, user) => {
    const entry = store.journal.create({
      title: String(title || 'Nova página').slice(0, 120),
      content: String(content || ''),
      folder: String(folder || '').slice(0, 60),
      data: { visibility: ['gm', 'all', 'users'].includes(visibility) ? visibility : 'gm', users: [], editable: false, img: null, author: user.id }
    });
    broadcast(entry);
    return { entry };
  }, { gm: true });

  on('journal:update', ({ id, title, content, folder, data }, user) => {
    const entry = store.journal.get(Number(id));
    if (!entry) fail('Página não encontrada.');
    const gm = user.role === 'gm';
    if (!gm && !(world.journalVisible(entry, user) && entry.data.editable)) fail('Você não pode editar esta página.');
    const patch = { content };
    if (gm) {
      patch.title = title; patch.folder = folder;
      if (data) {
        const d = {};
        if (data.visibility !== undefined) d.visibility = ['gm', 'all', 'users'].includes(data.visibility) ? data.visibility : 'gm';
        if (data.users !== undefined) d.users = (Array.isArray(data.users) ? data.users : []).map(Number);
        if (data.editable !== undefined) d.editable = !!data.editable;
        if (data.img !== undefined) d.img = data.img ? String(data.img).slice(0, 400) : null;
        if (data.gmNotes !== undefined) d.gmNotes = String(data.gmNotes).slice(0, 50000);
        patch.data = d;
      }
    }
    const updated = store.journal.update(entry.id, patch);
    broadcast(updated);
    return { entry: updated };
  }, { player: true });

  on('journal:delete', ({ id }) => {
    store.journal.remove(Number(id));
    rt.emitAll('journal:delete', { id: Number(id) });
  }, { gm: true });
}

module.exports = { register };
