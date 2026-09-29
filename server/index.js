// QuestVTT — servidor principal (Express + Socket.IO).
// Roda no PC do Mestre; os jogadores entram só pelo navegador (LAN ou Radmin VPN).
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { loadConfig, ROOT } = require('./config');
const { openDatabase } = require('./db');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const { registerUploadRoutes } = require('./uploads');
const { createBackups } = require('./backup');
const { loadSystem } = require('./systems');
const { createRealtime } = require('./realtime');
const { createWorld } = require('./world');
const { setupSockets } = require('./sockets');
const { printBanner } = require('./network');

function start(opts = {}) {
  const config = loadConfig();
  if (opts.port !== undefined) config.port = opts.port;
  const db = openDatabase(config.dataDir);
  const store = createStore(db);
  const system = loadSystem(ROOT, config.system);
  const auth = createAuth({ store, config });
  const backups = createBackups({ db, config });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: '2mb' }));

  // Cabeçalhos de segurança básicos.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' ws: wss:",
      "worker-src 'self' blob:"
    ].join('; '));
    next();
  });

  auth.registerRoutes(app);

  // Regras + compêndio do sistema (apenas para quem está logado e aprovado).
  app.get('/api/system', auth.requireUser, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(system.clientPayload());
  });

  // Arquivos do front-end.
  app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html' }));
  // PixiJS servido localmente (funciona mesmo sem internet).
  app.use('/vendor/pixi', express.static(path.join(ROOT, 'node_modules', 'pixi.js', 'dist')));
  // Código de cliente do sistema de jogo (ficha, diálogos...).
  app.use(`/systems/${system.id}`, express.static(path.join(system.dir, 'client')));
  app.get('/mesa', (req, res) => res.sendFile(path.join(ROOT, 'public', 'mesa.html')));

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 2e6,
    pingInterval: 10000,
    pingTimeout: 20000,
    // Reconexão automática: o cliente recupera o estado após quedas curtas.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 }
  });
  const rt = createRealtime(io);

  const ctx = { io, rt, store, config, system, auth, backups, engine: null };
  ctx.world = createWorld({ store, rt, config, getEngine: () => ctx.engine });
  if (system.createEngine) ctx.engine = system.createEngine(ctx);

  registerUploadRoutes(app, { store, config, auth });

  // Backup sob demanda (Mestre).
  app.post('/api/backup', auth.requireGM, async (req, res) => {
    const file = await backups.backup('manual');
    res.json({ ok: !!file, file: file ? path.basename(file) : null });
  });

  setupSockets(ctx);

  // Recarrega as regras quando um JSON muda — sem reiniciar o servidor.
  if (!opts.test) system.watch((result) => {
    if (result.ok) {
      console.log('✦ Regras recarregadas.');
      rt.emitAll('system:reload', {});
    } else {
      console.warn('⚠ JSON com erro — mantidas as regras anteriores:\n  ' + result.errors.join('\n  '));
      rt.emitGM('chat:message', { id: -Date.now(), type: 'system', content: `⚠ Erro ao recarregar regras: ${result.errors.join('; ')}`, data: {}, author: null, created_at: Date.now() });
    }
  });

  if (!opts.test) backups.start();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n✖ A porta ${config.port} já está em uso. Feche o outro programa ou troque "port" no config.json.\n`);
    } else {
      console.error('✖ Erro no servidor:', err);
    }
    process.exit(1);
  });

  server.listen(config.port, '0.0.0.0', () => {
    if (opts.quiet) return;
    printBanner(config.port, config.tableName);
    if (config.gmPassword === 'trocar-esta-senha') {
      console.log('  ⚠ ATENÇÃO: troque "gmPassword" no config.json antes de jogar!\n');
    }
  });

  // Encerramento limpo: backup final e fecha o banco.
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    console.log('\n✦ Encerrando... salvando backup.');
    backups.stop();
    backups.backupSync('saida');
    io.close();
    server.close();
    db.close();
    process.exit(0);
  }
  if (!opts.test) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  // Encerramento sem sair do processo (testes automatizados).
  async function close() {
    backups.stop();
    io.close();
    await new Promise(r => server.close(() => r()));
    db.close();
  }

  return { app, server, io, ctx, shutdown, close };
}

if (require.main === module) start();

module.exports = { start };
