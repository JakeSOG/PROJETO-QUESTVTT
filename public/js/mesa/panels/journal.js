// Diário: lore, notas do Mestre (ocultas) e notas compartilhadas. Pode virar handout.
import { state, on, isGM } from '../state.js';
import { call, upload } from '../net.js';
import { h, openWindow, formDialog, confirmDialog, pickFile, esc, debounce, toast } from '../ui.js';

// Markdown mínimo e seguro: títulos, negrito, itálico, listas, imagens e parágrafos.
export function renderMarkdown(src) {
  const lines = esc(src || '').split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    let l = raw
      .replace(/!\[([^\]]*)\]\((\/uploads\/[^)\s]+|https?:\/\/[^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>');
    if (/^\s*[-*] /.test(raw)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${l.replace(/^\s*[-*] /, '')}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^### /.test(raw)) html += `<h4>${l.slice(4)}</h4>`;
    else if (/^## /.test(raw)) html += `<h3>${l.slice(3)}</h3>`;
    else if (/^# /.test(raw)) html += `<h2>${l.slice(2)}</h2>`;
    else if (!raw.trim()) html += '<br>';
    else html += `<p style="margin:.3em 0">${l}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

export function journalPanel(app, panel) {
  const head = h('div.panel-head', h('h3', 'Diário'), isGM() ? h('button.small', { onclick: create }, '+ Página') : null);
  const body = h('div.panel-body');
  panel.append(head, body);

  async function create() {
    const r = await formDialog('Nova página', [
      { name: 'title', label: 'Título', value: '' },
      { name: 'folder', label: 'Pasta', value: '' },
      { name: 'visibility', label: 'Quem vê', type: 'select', value: 'gm', options: [{ value: 'gm', label: 'Só o Mestre' }, { value: 'all', label: 'Todos' }, { value: 'users', label: 'Jogadores escolhidos' }] }
    ]);
    if (!r) return;
    const res = await call('journal:create', r);
    if (res.entry) open(res.entry.id);
  }

  function render() {
    const entries = [...state.journal.values()].sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || a.title.localeCompare(b.title));
    body.replaceChildren();
    let folder = null;
    for (const e of entries) {
      if ((e.folder || '') !== folder) { folder = e.folder || ''; if (folder) body.append(h('div.group-title', folder)); }
      const vis = e.data.visibility;
      const el = h('div.list-item', h('div.thumb', vis === 'gm' ? '🔒' : vis === 'users' ? '👥' : '📜'), h('div.grow', h('div.name', e.title), h('div.small.muted', vis === 'gm' ? 'Só o Mestre' : vis === 'all' ? 'Todos' : 'Alguns jogadores', e.data.editable ? ' · editável' : '')));
      el.addEventListener('click', () => open(e.id));
      body.append(el);
    }
    if (!entries.length) body.append(h('p.muted', isGM() ? 'Crie páginas de lore, notas secretas e anotações compartilhadas.' : 'Nenhuma página compartilhada ainda.'));
  }

  function open(id) {
    const e = state.journal.get(id);
    if (!e) return;
    const canEdit = isGM() || e.data.editable;
    const win = openWindow({ id: `journal-${id}`, title: e.title, width: 560, height: 560 });
    let editing = false;
    const draw = () => {
      const cur = state.journal.get(id);
      if (!cur) { win.close(); return; }
      win.setTitle(cur.title);
      const view = h('div.selectable', { html: renderMarkdown(cur.content) || '<p class="muted">Página vazia.</p>' });
      const content = [];
      if (cur.data.img) content.push(h('img', { src: cur.data.img, alt: '', style: { maxWidth: '100%', display: 'block', margin: '0 auto 10px' } }));
      if (editing) {
        const ta = h('textarea', { rows: 16 }, cur.content);
        const save = debounce(() => call('journal:update', { id, content: ta.value }), 700);
        ta.addEventListener('input', save);
        content.push(h('div.small.muted', 'Formatação: # título, **negrito**, *itálico*, - lista, ![](url da imagem)'), ta);
      } else content.push(view);
      if (isGM()) {
        const notes = h('textarea', { rows: 5, placeholder: 'Notas ocultas do Mestre (os jogadores nunca recebem)' }, cur.data.gmNotes || '');
        notes.addEventListener('input', debounce(() => call('journal:update', { id, data: { gmNotes: notes.value } }), 700));
        content.push(h('div.group-title', 'Notas do Mestre'), notes);
      }
      win.setContent(content);
      const foot = [];
      if (canEdit) foot.push(h('button', { onclick: () => { editing = !editing; draw(); } }, editing ? 'Ver' : 'Editar'));
      if (isGM()) {
        foot.push(
          h('button', { onclick: () => settings(cur) }, 'Visibilidade'),
          h('button', { onclick: async () => { const f = await pickFile('image/*'); if (!f) return; const url = await upload('handout', f); if (url) call('journal:update', { id, data: { img: url } }); } }, '🖼 Imagem'),
          h('button', { onclick: () => call('handout:show', { title: cur.title, text: cur.content.slice(0, 5000), img: cur.data.img }) }, 'Mostrar a todos'),
          h('button', { onclick: async () => { if (await confirmDialog('Apagar página', `Apagar <b>${esc(cur.title)}</b>?`, { danger: true })) { call('journal:delete', { id }); win.close(); } } }, '🗑'));
      }
      win.setFooter(foot);
    };
    draw();
    const off = on(`journal:${id}`, () => { if (!editing) draw(); });
    const oldClose = win.close;
    win.close = () => { off(); oldClose(); };
  }

  async function settings(e) {
    const players = state.users.filter(u => u.role === 'player');
    const r = await formDialog('Visibilidade', [
      { name: 'title', label: 'Título', value: e.title },
      { name: 'folder', label: 'Pasta', value: e.folder },
      { name: 'visibility', label: 'Quem vê', type: 'select', value: e.data.visibility, options: [{ value: 'gm', label: 'Só o Mestre' }, { value: 'all', label: 'Todos' }, { value: 'users', label: 'Jogadores escolhidos' }] },
      { name: 'editable', label: 'Jogadores podem editar', type: 'checkbox', value: e.data.editable },
      ...players.map(p => ({ name: `u${p.id}`, label: `Vê: ${p.name}`, type: 'checkbox', value: (e.data.users || []).includes(p.id) }))
    ]);
    if (!r) return;
    call('journal:update', { id: e.id, title: r.title, folder: r.folder, data: { visibility: r.visibility, editable: r.editable, users: players.filter(p => r[`u${p.id}`]).map(p => p.id) } });
  }

  on('journal', render);
  on('world:reset', render);
}
