// Jogadores (aprovação pelo Mestre) e configurações pessoais.
import { state, on, isGM } from '../state.js';
import { call, upload } from '../net.js';
import { h, confirmDialog, formDialog, pickFile, toast } from '../ui.js';

export function settingsPanel(app, panel) {
  const head = h('div.panel-head', h('h3', 'Jogadores e configurações'));
  const body = h('div.panel-body');
  panel.append(head, body);

  function render() {
    body.replaceChildren();
    // --- Pessoal ---
    body.append(h('div.group-title', 'Você'));
    const color = h('input', { type: 'color', value: state.user.color });
    color.addEventListener('change', () => call('users:color', { color: color.value }));
    body.append(h('div.row', h('span', state.user.name), h('span.muted', `(${roleName(state.user.role)})`), h('label.row.right', 'Cor', color)));
    const personal = app.system?.personalSettings ? app.system.personalSettings(app) : null;
    if (personal) body.append(personal);
    body.append(h('div.row', { style: { marginTop: '6px' } },
      h('button.small', { onclick: async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/'; } }, 'Sair da mesa')));

    // --- Mestre ---
    if (isGM()) {
      const pending = state.users.filter(u => u.status === 'pending');
      body.append(h('div.group-title', `Jogadores${pending.length ? ` — ${pending.length} aguardando` : ''}`));
      for (const u of state.users.filter(x => x.role !== 'gm')) body.append(userRow(u));
      if (!state.users.some(x => x.role !== 'gm')) body.append(h('p.muted.small', 'Ninguém entrou ainda. Passe o endereço (Radmin: 26.x.x.x:porta) para os jogadores.'));

      body.append(h('div.group-title', 'Mesa'));
      body.append(h('div.col',
        h('button.small', { onclick: showImageHandout }, '🖼 Mostrar imagem a todos (handout)'),
        h('button.small', { onclick: () => call('handout:close') }, 'Fechar handout'),
        h('button.small', { onclick: async () => { const r = await call('rules:reload'); if (r.ok) toast('Regras recarregadas.', 'ok'); } }, '↻ Recarregar regras (JSON)'),
        h('button.small', { onclick: async () => { const res = await fetch('/api/backup', { method: 'POST' }); const d = await res.json(); toast(d.ok ? `Backup salvo: ${d.file}` : 'Falha no backup.', d.ok ? 'ok' : 'error'); } }, '💾 Fazer backup agora')));
      const gmExtra = app.system?.gmSettings ? app.system.gmSettings(app) : null;
      if (gmExtra) body.append(gmExtra);
    }
    body.append(h('div.group-title', 'Atalhos'),
      h('div.small.muted', { html: 'Arrastar o mapa: botão esquerdo no vazio ou botão direito · Zoom: roda do mouse · <b>T</b>: marcar alvo sob o mouse · Setas: mover token selecionado · <b>Alt+clique</b>: ping · Duplo clique no token: ficha · <b>Esc</b>: limpar seleção' }));
  }

  function userRow(u) {
    return h('div.list-item', { style: { cursor: 'default' } },
      h('span.player-dot', { style: { background: u.color, color: u.color } }),
      h('div.grow', h('div.name', u.name), h('div.small.muted', `${roleName(u.role)} · ${u.status === 'pending' ? 'aguardando aprovação' : u.status === 'banned' ? 'bloqueado' : u.online ? 'online' : 'offline'}`)),
      u.status === 'pending' ? h('button.small.primary', { onclick: () => call('users:set', { id: u.id, status: 'approved' }) }, 'Aprovar') : null,
      u.status === 'banned' ? h('button.small', { onclick: () => call('users:set', { id: u.id, status: 'approved' }) }, 'Desbloquear') : null,
      h('select.small', { title: 'Papel', onchange: (e) => call('users:set', { id: u.id, role: e.target.value }) },
        h('option', { value: 'player', selected: u.role === 'player' }, 'Jogador'), h('option', { value: 'spectator', selected: u.role === 'spectator' }, 'Espectador')),
      u.status !== 'banned' ? h('button.small.ghost', { title: 'Bloquear', onclick: async () => { if (await confirmDialog('Bloquear', `Bloquear <b>${u.name}</b>? Ele será desconectado.`, { danger: true })) call('users:set', { id: u.id, status: 'banned' }); } }, '⛔') : null,
      h('button.small.ghost', { title: 'Remover usuário', onclick: async () => { if (await confirmDialog('Remover', `Remover <b>${u.name}</b>? (a ficha continua existindo)`, { danger: true })) call('users:delete', { id: u.id }); } }, '🗑'));
  }

  async function showImageHandout() {
    const f = await pickFile('image/*');
    if (!f) return;
    const url = await upload('handout', f);
    if (!url) return;
    const players = state.users.filter(u => u.role === 'player');
    const r = await formDialog('Handout', [
      { name: 'title', label: 'Título', value: '' },
      { name: 'text', label: 'Texto (opcional)', type: 'textarea', value: '' },
      { name: 'to', label: 'Para', type: 'select', value: '', options: [{ value: '', label: 'Todos' }, ...players.map(p => ({ value: p.id, label: p.name }))] }
    ]);
    if (r) call('handout:show', { title: r.title, text: r.text, img: url, to: r.to ? [Number(r.to)] : null });
  }

  on('users', render);
  on('world:reset', render);
  on('sys:settings', render);
}

const roleName = (r) => ({ gm: 'Mestre', player: 'Jogador', spectator: 'Espectador' }[r] || r);
