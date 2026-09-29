// Música e ambiente: playlists do Mestre, tocando sincronizado para todos; volume individual.
import { state, on, isGM } from '../state.js';
import { call, upload } from '../net.js';
import { h, formDialog, pickFile, confirmDialog, toast } from '../ui.js';
import { getMasterVolume, setMasterVolume } from '../audio.js';

export function audioPanel(app, panel) {
  const head = h('div.panel-head', h('h3', 'Música e ambiente'), isGM() ? h('button.small', { onclick: newPlaylist }, '+ Playlist') : null);
  const body = h('div.panel-body');
  panel.append(head, body);

  async function newPlaylist() {
    const r = await formDialog('Nova playlist', [{ name: 'name', label: 'Nome', value: 'Ambiente' }]);
    if (r) call('playlist:create', r);
  }

  async function addTrack(pl) {
    const file = await pickFile('audio/*');
    if (!file) return;
    toast('Enviando áudio…');
    const url = await upload('audio', file);
    if (!url) return;
    const r = await formDialog('Nova faixa', [
      { name: 'name', label: 'Nome', value: file.name.replace(/\.[^.]+$/, '') },
      { name: 'loop', label: 'Repetir (loop)', type: 'checkbox', value: true }
    ]);
    if (r) call('playlist:addTrack', { id: pl.id, name: r.name, url, loop: r.loop });
  }

  function render() {
    const playing = state.audio?.playing || {};
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: getMasterVolume(), style: { flex: 1 } });
    vol.addEventListener('input', () => setMasterVolume(Number(vol.value)));
    body.replaceChildren(h('div.row', h('span', '🔊 Meu volume'), vol));
    const now = Object.values(playing);
    body.append(h('div.group-title', 'Tocando agora'));
    if (!now.length) body.append(h('p.muted.small', 'Silêncio… por enquanto.'));
    for (const t of now) {
      body.append(h('div.list-item', h('div.thumb', '♫'), h('div.grow', h('div.name', t.name)),
        isGM() ? h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: t.volume, style: { width: '80px' }, title: 'Volume para todos', onchange: (e) => call('audio:volume', { trackId: t.trackId, volume: Number(e.target.value) }) }) : null,
        isGM() ? h('button.small', { onclick: () => call('audio:stop', { trackId: t.trackId }) }, '■') : null));
    }
    if (!isGM()) return;
    if (now.length) body.append(h('button.small', { onclick: () => call('audio:stop', {}) }, 'Parar tudo'));
    for (const pl of state.playlists) {
      body.append(h('div.group-title', h('span', pl.name), ' ',
        h('button.small.ghost', { title: 'Adicionar faixa', onclick: () => addTrack(pl) }, '+'),
        h('button.small.ghost', { title: 'Renomear', onclick: async () => { const r = await formDialog('Renomear', [{ name: 'name', label: 'Nome', value: pl.name }]); if (r) call('playlist:rename', { id: pl.id, name: r.name }); } }, '✎'),
        h('button.small.ghost', { title: 'Apagar playlist', onclick: async () => { if (await confirmDialog('Apagar playlist', `Apagar <b>${pl.name}</b>?`, { danger: true })) call('playlist:delete', { id: pl.id }); } }, '🗑')));
      for (const t of pl.data.tracks || []) {
        const on = !!playing[t.id];
        body.append(h('div.list-item',
          h('button.small', { class: on ? 'small active' : 'small', title: on ? 'Parar' : 'Tocar para todos', onclick: () => call(on ? 'audio:stop' : 'audio:play', on ? { trackId: t.id } : { playlistId: pl.id, trackId: t.id }) }, on ? '■' : '▶'),
          h('div.grow', h('div.name', t.name), h('div.small.muted', t.loop ? 'loop' : 'uma vez')),
          h('button.small.ghost', { title: 'Efeito único (sem registrar)', onclick: () => call('audio:sfx', { url: t.url, volume: t.volume }) }, '⚡'),
          h('button.small.ghost', { title: 'Remover', onclick: () => call('playlist:removeTrack', { id: pl.id, trackId: t.id }) }, '✕')));
      }
      if (!(pl.data.tracks || []).length) body.append(h('p.muted.small', 'Sem faixas. Clique em + para enviar um arquivo .mp3/.ogg.'));
    }
    if (!state.playlists.length) body.append(h('p.muted.small', 'Crie playlists de música e ambiente (chuva, sinos, sussurros). Várias faixas podem tocar juntas.'));
  }

  on('audio', render);
  on('playlists', render);
  on('world:reset', render);
}
