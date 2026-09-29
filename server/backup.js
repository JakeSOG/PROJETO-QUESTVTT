// Backup automático do banco em /data/backups (ao iniciar, a cada X minutos e ao encerrar).
const path = require('path');
const fs = require('fs');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function createBackups({ db, config }) {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });

  async function backup(reason = 'auto') {
    const file = path.join(dir, `questvtt-${stamp()}-${reason}.db`);
    try {
      await db.backup(file);
      prune();
      return file;
    } catch (err) {
      console.error('✖ Falha no backup:', err.message);
      return null;
    }
  }

  // Backup síncrono (usado ao encerrar o processo).
  function backupSync(reason = 'saida') {
    const file = path.join(dir, `questvtt-${stamp()}-${reason}.db`);
    try {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      prune();
    } catch (err) {
      console.error('✖ Falha no backup:', err.message);
    }
  }

  function prune() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
    const excess = files.length - Math.max(1, config.backupKeep);
    for (let i = 0; i < excess; i++) fs.unlinkSync(path.join(dir, files[i]));
  }

  let timer = null;
  function start() {
    backup('inicio').then(f => f && console.log(`✦ Backup criado: ${path.basename(f)}`));
    if (config.backupEveryMinutes > 0) {
      timer = setInterval(() => backup('auto'), config.backupEveryMinutes * 60_000);
      timer.unref();
    }
  }
  function stop() { if (timer) clearInterval(timer); }

  return { backup, backupSync, start, stop, dir };
}

module.exports = { createBackups };
