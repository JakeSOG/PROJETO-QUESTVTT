// Banco SQLite (better-sqlite3) com migrações versionadas.
// O banco guarda o ESTADO da mesa. As REGRAS ficam nos JSON do sistema.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Cada migração roda uma única vez, em ordem. Nunca edite uma migração antiga:
// crie uma nova no fim da lista.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'player',
    status TEXT NOT NULL DEFAULT 'pending',
    color TEXT NOT NULL DEFAULT '#c9a45c',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE TABLE characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    img TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE walls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE lights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE fog (
    scene_id INTEGER PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,
    data TEXT NOT NULL DEFAULT '{"shapes":[]}'
  );
  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    whisper_to TEXT,
    blind INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE combat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE combatants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    combat_id INTEGER NOT NULL REFERENCES combat(id) ON DELETE CASCADE,
    token_id INTEGER REFERENCES tokens(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    folder TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{"tracks":[]}'
  );
  CREATE TABLE uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    original TEXT,
    mime TEXT,
    size INTEGER,
    user_id INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE rolltables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_tokens_scene ON tokens(scene_id);
  CREATE INDEX idx_walls_scene ON walls(scene_id);
  CREATE INDEX idx_lights_scene ON lights(scene_id);
  CREATE INDEX idx_chat_created ON chat_messages(created_at);
  `
];

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'questvtt.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.prepare('UPDATE schema_version SET version = ?').run(i + 1);
    })();
    console.log(`✦ Migração ${i + 1} aplicada.`);
  }
  db.file = file;
  return db;
}

// ---- Helpers genéricos para tabelas com coluna "data" em JSON ----

function parseRow(row) {
  if (!row) return null;
  const out = { ...row };
  if (typeof out.data === 'string') {
    try { out.data = JSON.parse(out.data); } catch { out.data = {}; }
  }
  if (typeof out.whisper_to === 'string') {
    try { out.whisper_to = JSON.parse(out.whisper_to); } catch { out.whisper_to = null; }
  }
  return out;
}

module.exports = { openDatabase, parseRow };
