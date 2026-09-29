// Música e ambiente (playlists sincronizadas), handouts e tabelas aleatórias do Mestre.
const crypto = require('crypto');

function register(ctx) {
  const { on, store, world, rt, fail } = ctx;

  const broadcastPlaylists = () => rt.emitGM('playlists:update', store.playlists.list());
  const cleanUrl = (u) => {
    const s = String(u || '');
    if (!s.startsWith('/uploads/') && !/^https?:\/\//.test(s)) fail('Endereço de áudio inválido.');
    return s.slice(0, 400);
  };

  // ---------- Playlists ----------
  on('playlist:create', ({ name }) => { store.playlists.create(String(name || 'Nova playlist')); broadcastPlaylists(); }, { gm: true });
  on('playlist:rename', ({ id, name }) => { store.playlists.update(Number(id), { name }); broadcastPlaylists(); }, { gm: true });
  on('playlist:delete', ({ id }) => { store.playlists.remove(Number(id)); broadcastPlaylists(); }, { gm: true });
  on('playlist:addTrack', ({ id, name, url, loop }) => {
    const pl = store.playlists.get(Number(id));
    if (!pl) fail('Playlist não encontrada.');
    const tracks = [...(pl.data.tracks || []), { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'Faixa').slice(0, 80), url: cleanUrl(url), loop: loop !== false, volume: 0.8 }];
    store.playlists.update(pl.id, { data: { tracks } });
    broadcastPlaylists();
  }, { gm: true });
  on('playlist:removeTrack', ({ id, trackId }) => {
    const pl = store.playlists.get(Number(id));
    if (!pl) return;
    store.playlists.update(pl.id, { data: { tracks: (pl.data.tracks || []).filter(t => t.id !== trackId) } });
    broadcastPlaylists();
  }, { gm: true });
  on('playlist:trackVolume', ({ id, trackId, volume }) => {
    const pl = store.playlists.get(Number(id));
    if (!pl) return;
    const tracks = (pl.data.tracks || []).map(t => t.id === trackId ? { ...t, volume: Math.max(0, Math.min(1, Number(volume) || 0)) } : t);
    store.playlists.update(pl.id, { data: { tracks } });
    broadcastPlaylists();
  }, { gm: true });

  // ---------- Tocando agora (vários canais simultâneos: música + ambiente) ----------
  // playing: { [trackId]: { trackId, name, url, loop, volume, startedAt } }
  let playing = store.settings.get('audio.playing', {});
  ctx.audioState = () => ({ playing, serverNow: Date.now() });

  function broadcastAudio() {
    store.settings.set('audio.playing', playing);
    rt.emitAll('audio:state', ctx.audioState());
  }

  on('audio:play', ({ playlistId, trackId }) => {
    const pl = store.playlists.get(Number(playlistId));
    const track = pl && (pl.data.tracks || []).find(t => t.id === trackId);
    if (!track) fail('Faixa não encontrada.');
    playing = { ...playing, [track.id]: { trackId: track.id, name: track.name, url: track.url, loop: track.loop, volume: track.volume ?? 0.8, startedAt: Date.now() } };
    broadcastAudio();
  }, { gm: true });

  on('audio:stop', ({ trackId }) => {
    if (trackId) { const p = { ...playing }; delete p[trackId]; playing = p; } else playing = {};
    broadcastAudio();
  }, { gm: true });

  on('audio:volume', ({ trackId, volume }) => {
    if (!playing[trackId]) return;
    playing = { ...playing, [trackId]: { ...playing[trackId], volume: Math.max(0, Math.min(1, Number(volume) || 0)) } };
    broadcastAudio();
  }, { gm: true });

  // Efeito sonoro de disparo único (não fica "tocando").
  on('audio:sfx', ({ url, volume }) => {
    rt.emitAll('audio:sfx', { url: cleanUrl(url), volume: Math.max(0, Math.min(1, Number(volume) || 0.8)) });
  }, { gm: true });

  // ---------- Handouts ----------
  // { title, text, img, to: null (todos) | [userIds] }
  let handout = null;
  ctx.currentHandout = (user) => {
    if (!handout) return null;
    if (user.role === 'gm' || !handout.to || handout.to.includes(user.id)) return handout;
    return null;
  };
  on('handout:show', ({ title, text, img, to }) => {
    handout = {
      id: Date.now(),
      title: String(title || '').slice(0, 120),
      text: String(text || '').slice(0, 5000),
      img: img ? String(img).slice(0, 400) : null,
      to: Array.isArray(to) && to.length ? to.map(Number) : null
    };
    rt.emitFiltered('handout:show', (u) => ctx.currentHandout(u) || undefined);
  }, { gm: true });
  on('handout:close', () => {
    handout = null;
    rt.emitAll('handout:close', {});
  }, { gm: true });

  // ---------- Tabelas aleatórias do Mestre ----------
  const broadcastTables = () => rt.emitAll('rolltables:update', store.rolltables.list());
  function parseTable(lines) {
    const results = String(lines || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 200).map((text, i) => ({ range: [i + 1, i + 1], text: text.slice(0, 500) }));
    if (!results.length) fail('A tabela precisa de pelo menos uma linha.');
    return { dice: `1d${results.length}`, results };
  }
  on('rolltable:save', ({ id, name, lines }) => {
    const data = parseTable(lines);
    const nm = String(name || 'Tabela').slice(0, 80);
    if (id) store.rolltables.update(Number(id), nm, data); else store.rolltables.create(nm, data);
    broadcastTables();
  }, { gm: true });
  on('rolltable:delete', ({ id }) => { store.rolltables.remove(Number(id)); broadcastTables(); }, { gm: true });
}

module.exports = { register };
