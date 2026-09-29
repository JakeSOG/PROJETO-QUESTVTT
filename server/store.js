// Camada de acesso a dados. Todas as leituras/escritas do banco passam por aqui.
const { parseRow } = require('./db');

const now = () => Date.now();

// Mescla profunda simples (objetos), usada para "patches" de dados.
// Arrays são substituídos, não mesclados. Valor null apaga a chave.
function deepMerge(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) { delete out[k]; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function createStore(db) {
  const j = (v) => JSON.stringify(v ?? {});

  // Fábrica para tabelas "filhas de cena" (tokens, walls, lights).
  function sceneChild(table, extraCols = []) {
    const cols = ['scene_id', ...extraCols, 'data'];
    return {
      list: (sceneId) => db.prepare(`SELECT * FROM ${table} WHERE scene_id = ? ORDER BY id`).all(sceneId).map(parseRow),
      get: (id) => parseRow(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)),
      create(row) {
        const values = cols.map(c => c === 'data' ? j(row.data) : row[c] ?? null);
        const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...values);
        return this.get(info.lastInsertRowid);
      },
      update(id, dataPatch, replace = false) {
        const cur = this.get(id);
        if (!cur) return null;
        const data = replace ? dataPatch : deepMerge(cur.data, dataPatch);
        db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(j(data), id);
        return { ...cur, data };
      },
      remove: (id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0,
      clear: (sceneId) => db.prepare(`DELETE FROM ${table} WHERE scene_id = ?`).run(sceneId)
    };
  }

  const store = {
    db,
    deepMerge,

    // ---------- Usuários e sessões ----------
    users: {
      get: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
      byName: (name) => db.prepare('SELECT * FROM users WHERE name = ?').get(name),
      list: () => db.prepare('SELECT id, name, role, status, color, created_at FROM users ORDER BY id').all(),
      create({ name, passwordHash, role, status, color }) {
        const info = db.prepare('INSERT INTO users (name, password_hash, role, status, color, created_at) VALUES (?,?,?,?,?,?)')
          .run(name, passwordHash, role, status, color, now());
        return store.users.get(info.lastInsertRowid);
      },
      update(id, fields) {
        const allowed = ['name', 'password_hash', 'role', 'status', 'color'];
        for (const [k, v] of Object.entries(fields)) {
          if (!allowed.includes(k)) continue;
          db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, id);
        }
        return store.users.get(id);
      },
      remove: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id)
    },
    sessions: {
      create(token, userId) {
        db.prepare('INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?,?,?,?)').run(token, userId, now(), now());
      },
      get(token) {
        const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
        if (s) db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now(), token);
        return s;
      },
      remove: (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token),
      removeForUser: (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId),
      purgeOld: (maxAgeMs) => db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(now() - maxAgeMs)
    },

    // ---------- Atores (fichas de caçadores e criaturas) ----------
    actors: {
      get: (id) => parseRow(db.prepare('SELECT * FROM characters WHERE id = ?').get(id)),
      list: () => db.prepare('SELECT * FROM characters ORDER BY type, name').all().map(parseRow),
      create({ type, name, img, owner_id, data }) {
        const info = db.prepare('INSERT INTO characters (type, name, img, owner_id, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(type, name, img ?? null, owner_id ?? null, j(data), now(), now());
        return store.actors.get(info.lastInsertRowid);
      },
      // patch: { name?, img?, owner_id?, data? (mesclado) }, replaceData = true substitui data inteiro
      update(id, patch, replaceData = false) {
        const cur = store.actors.get(id);
        if (!cur) return null;
        const next = { ...cur };
        if (patch.name !== undefined) next.name = String(patch.name).slice(0, 80) || cur.name;
        if (patch.img !== undefined) next.img = patch.img;
        if (patch.owner_id !== undefined) next.owner_id = patch.owner_id;
        if (patch.data !== undefined) next.data = replaceData ? patch.data : deepMerge(cur.data, patch.data);
        db.prepare('UPDATE characters SET name = ?, img = ?, owner_id = ?, data = ?, updated_at = ? WHERE id = ?')
          .run(next.name, next.img, next.owner_id, j(next.data), now(), id);
        return store.actors.get(id);
      },
      remove: (id) => db.prepare('DELETE FROM characters WHERE id = ?').run(id).changes > 0
    },

    // ---------- Cenas ----------
    scenes: {
      get: (id) => parseRow(db.prepare('SELECT * FROM scenes WHERE id = ?').get(id)),
      list: () => db.prepare('SELECT * FROM scenes ORDER BY sort, id').all().map(parseRow),
      active: () => parseRow(db.prepare('SELECT * FROM scenes WHERE active = 1 LIMIT 1').get()),
      create({ name, data }) {
        const max = db.prepare('SELECT COALESCE(MAX(sort),0) AS m FROM scenes').get().m;
        const info = db.prepare('INSERT INTO scenes (name, sort, data) VALUES (?,?,?)').run(name, max + 1, j(data));
        db.prepare('INSERT OR IGNORE INTO fog (scene_id, data) VALUES (?, ?)').run(info.lastInsertRowid, j({ shapes: [] }));
        return store.scenes.get(info.lastInsertRowid);
      },
      update(id, patch) {
        const cur = store.scenes.get(id);
        if (!cur) return null;
        const name = patch.name !== undefined ? String(patch.name).slice(0, 80) : cur.name;
        const data = patch.data !== undefined ? deepMerge(cur.data, patch.data) : cur.data;
        db.prepare('UPDATE scenes SET name = ?, data = ? WHERE id = ?').run(name, j(data), id);
        return store.scenes.get(id);
      },
      activate(id) {
        db.transaction(() => {
          db.prepare('UPDATE scenes SET active = 0').run();
          db.prepare('UPDATE scenes SET active = 1 WHERE id = ?').run(id);
        })();
      },
      remove: (id) => db.prepare('DELETE FROM scenes WHERE id = ?').run(id).changes > 0
    },
    tokens: sceneChild('tokens', ['actor_id']),
    walls: sceneChild('walls'),
    lights: sceneChild('lights'),
    fog: {
      get(sceneId) {
        const row = db.prepare('SELECT data FROM fog WHERE scene_id = ?').get(sceneId);
        if (!row) return { shapes: [] };
        try { return JSON.parse(row.data); } catch { return { shapes: [] }; }
      },
      set(sceneId, data) {
        db.prepare('INSERT INTO fog (scene_id, data) VALUES (?, ?) ON CONFLICT(scene_id) DO UPDATE SET data = excluded.data')
          .run(sceneId, j(data));
      }
    },

    // ---------- Chat ----------
    chat: {
      add({ user_id, type, content, data, whisper_to, blind }) {
        const info = db.prepare('INSERT INTO chat_messages (user_id, type, content, data, whisper_to, blind, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(user_id ?? null, type || 'text', content ?? '', j(data), whisper_to ? JSON.stringify(whisper_to) : null, blind ? 1 : 0, now());
        return store.chat.get(info.lastInsertRowid);
      },
      get: (id) => parseRow(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id)),
      update(id, dataPatch) {
        const cur = store.chat.get(id);
        if (!cur) return null;
        db.prepare('UPDATE chat_messages SET data = ? WHERE id = ?').run(j(deepMerge(cur.data, dataPatch)), id);
        return store.chat.get(id);
      },
      recent: (limit) => db.prepare('SELECT * FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?) ORDER BY id').all(limit).map(parseRow),
      clear: () => db.prepare('DELETE FROM chat_messages').run(),
      remove: (id) => db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id)
    },

    // ---------- Combate ----------
    combat: {
      active: () => parseRow(db.prepare('SELECT * FROM combat WHERE active = 1 ORDER BY id DESC LIMIT 1').get()),
      get: (id) => parseRow(db.prepare('SELECT * FROM combat WHERE id = ?').get(id)),
      create(sceneId, data) {
        const info = db.prepare('INSERT INTO combat (scene_id, active, data) VALUES (?, 1, ?)').run(sceneId, j(data));
        return store.combat.get(info.lastInsertRowid);
      },
      update(id, dataPatch) {
        const cur = store.combat.get(id);
        if (!cur) return null;
        db.prepare('UPDATE combat SET data = ? WHERE id = ?').run(j(deepMerge(cur.data, dataPatch)), id);
        return store.combat.get(id);
      },
      end: (id) => db.prepare('DELETE FROM combat WHERE id = ?').run(id),
      combatants: (combatId) => db.prepare('SELECT * FROM combatants WHERE combat_id = ? ORDER BY id').all(combatId).map(parseRow),
      getCombatant: (id) => parseRow(db.prepare('SELECT * FROM combatants WHERE id = ?').get(id)),
      addCombatant(combatId, tokenId, actorId, data) {
        const info = db.prepare('INSERT INTO combatants (combat_id, token_id, actor_id, data) VALUES (?,?,?,?)').run(combatId, tokenId, actorId, j(data));
        return store.combat.getCombatant(info.lastInsertRowid);
      },
      updateCombatant(id, dataPatch) {
        const cur = store.combat.getCombatant(id);
        if (!cur) return null;
        db.prepare('UPDATE combatants SET data = ? WHERE id = ?').run(j(deepMerge(cur.data, dataPatch)), id);
        return store.combat.getCombatant(id);
      },
      removeCombatant: (id) => db.prepare('DELETE FROM combatants WHERE id = ?').run(id)
    },

    // ---------- Diário ----------
    journal: {
      get: (id) => parseRow(db.prepare('SELECT * FROM journal WHERE id = ?').get(id)),
      list: () => db.prepare('SELECT * FROM journal ORDER BY folder, sort, title').all().map(parseRow),
      create({ title, content, folder, data }) {
        const info = db.prepare('INSERT INTO journal (title, content, folder, data, updated_at) VALUES (?,?,?,?,?)')
          .run(title, content || '', folder || '', j(data), now());
        return store.journal.get(info.lastInsertRowid);
      },
      update(id, patch) {
        const cur = store.journal.get(id);
        if (!cur) return null;
        const title = patch.title !== undefined ? String(patch.title).slice(0, 120) : cur.title;
        const content = patch.content !== undefined ? String(patch.content).slice(0, 200000) : cur.content;
        const folder = patch.folder !== undefined ? String(patch.folder).slice(0, 60) : cur.folder;
        const data = patch.data !== undefined ? deepMerge(cur.data, patch.data) : cur.data;
        db.prepare('UPDATE journal SET title = ?, content = ?, folder = ?, data = ?, updated_at = ? WHERE id = ?')
          .run(title, content, folder, j(data), now(), id);
        return store.journal.get(id);
      },
      remove: (id) => db.prepare('DELETE FROM journal WHERE id = ?').run(id)
    },

    // ---------- Playlists ----------
    playlists: {
      get: (id) => parseRow(db.prepare('SELECT * FROM playlists WHERE id = ?').get(id)),
      list: () => db.prepare('SELECT * FROM playlists ORDER BY name').all().map(parseRow),
      create(name) {
        const info = db.prepare('INSERT INTO playlists (name, data) VALUES (?, ?)').run(name, j({ tracks: [] }));
        return store.playlists.get(info.lastInsertRowid);
      },
      update(id, patch) {
        const cur = store.playlists.get(id);
        if (!cur) return null;
        const name = patch.name !== undefined ? String(patch.name).slice(0, 80) : cur.name;
        const data = patch.data !== undefined ? { ...cur.data, ...patch.data } : cur.data;
        db.prepare('UPDATE playlists SET name = ?, data = ? WHERE id = ?').run(name, j(data), id);
        return store.playlists.get(id);
      },
      remove: (id) => db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
    },

    // ---------- Tabelas aleatórias criadas pelo Mestre ----------
    rolltables: {
      get: (id) => parseRow(db.prepare('SELECT * FROM rolltables WHERE id = ?').get(id)),
      list: () => db.prepare('SELECT * FROM rolltables ORDER BY name').all().map(parseRow),
      create(name, data) {
        const info = db.prepare('INSERT INTO rolltables (name, data) VALUES (?, ?)').run(name, j(data));
        return store.rolltables.get(info.lastInsertRowid);
      },
      update(id, name, data) {
        db.prepare('UPDATE rolltables SET name = ?, data = ? WHERE id = ?').run(name, j(data), id);
        return store.rolltables.get(id);
      },
      remove: (id) => db.prepare('DELETE FROM rolltables WHERE id = ?').run(id)
    },

    // ---------- Uploads e configurações ----------
    uploads: {
      add({ kind, filename, original, mime, size, user_id }) {
        const info = db.prepare('INSERT INTO uploads (kind, filename, original, mime, size, user_id, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(kind, filename, original, mime, size, user_id, now());
        return db.prepare('SELECT * FROM uploads WHERE id = ?').get(info.lastInsertRowid);
      },
      list: (kind) => kind
        ? db.prepare('SELECT * FROM uploads WHERE kind = ? ORDER BY id DESC').all(kind)
        : db.prepare('SELECT * FROM uploads ORDER BY id DESC').all()
    },
    settings: {
      get(key, fallback = null) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (!row) return fallback;
        try { return JSON.parse(row.value); } catch { return fallback; }
      },
      set(key, value) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(key, JSON.stringify(value));
      }
    }
  };
  return store;
}

module.exports = { createStore, deepMerge };
