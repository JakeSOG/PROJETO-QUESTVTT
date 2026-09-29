// Login, sessões e papéis (Mestre, Jogador, Espectador).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE = 'qvtt_session';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 dias

// Paleta de cores atribuídas aos jogadores (indicador de online / cursores / ping).
const PALETTE = ['#c0392b', '#d4a017', '#2e86c1', '#28b463', '#8e44ad', '#e67e22', '#16a085', '#c2185b', '#7f8c8d', '#a1887f'];

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, role: u.role, status: u.status, color: u.color };
}

function createAuth({ store, config }) {
  // Hash da senha do Mestre em memória (a senha em si fica no config.json do PC do Mestre).
  const gmHash = bcrypt.hashSync(String(config.gmPassword), 10);

  // Garante que o usuário Mestre exista.
  let gm = store.users.byName(config.gmName);
  if (!gm) {
    gm = store.users.create({ name: config.gmName, passwordHash: null, role: 'gm', status: 'approved', color: '#8b0000' });
  } else if (gm.role !== 'gm') {
    store.users.update(gm.id, { role: 'gm', status: 'approved' });
  }
  store.sessions.purgeOld(SESSION_MAX_AGE);

  // Limite simples de tentativas de login por IP (proteção contra força bruta).
  const attempts = new Map();
  function tooManyAttempts(ip) {
    const nowMs = Date.now();
    const rec = attempts.get(ip) || { count: 0, since: nowMs };
    if (nowMs - rec.since > 60_000) { rec.count = 0; rec.since = nowMs; }
    rec.count++;
    attempts.set(ip, rec);
    return rec.count > 15;
  }

  function nextColor() {
    const used = new Set(store.users.list().map(u => u.color));
    return PALETTE.find(c => !used.has(c)) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  function userFromToken(token) {
    if (!token) return null;
    const s = store.sessions.get(token);
    if (!s) return null;
    const u = store.users.get(s.user_id);
    if (!u || u.status === 'banned') return null;
    return u;
  }

  function userFromRequest(req) {
    return userFromToken(parseCookies(req.headers.cookie)[COOKIE]);
  }

  function startSession(res, user) {
    const token = crypto.randomBytes(32).toString('hex');
    store.sessions.create(token, user.id);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE / 1000}`);
    return token;
  }

  function registerRoutes(app) {
    app.post('/api/login', (req, res) => {
      const ip = req.ip || req.socket.remoteAddress;
      if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });

      const name = String(req.body?.name || '').trim().slice(0, 32);
      const password = String(req.body?.password || '');
      const tablePassword = String(req.body?.tablePassword || '');
      const spectator = !!req.body?.spectator;
      if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
      if (!/^[\p{L}\p{N} _.'-]+$/u.test(name)) return res.status(400).json({ error: 'Nome com caracteres inválidos.' });

      // --- Mestre ---
      if (name.toLowerCase() === String(config.gmName).toLowerCase()) {
        if (!bcrypt.compareSync(password, gmHash)) return res.status(401).json({ error: 'Senha do Mestre incorreta.' });
        const user = store.users.byName(config.gmName);
        startSession(res, user);
        return res.json({ user: publicUser(user) });
      }

      // --- Jogadores e espectadores ---
      if (config.tablePassword && tablePassword !== String(config.tablePassword)) {
        return res.status(401).json({ error: 'Senha da mesa incorreta.' });
      }
      let user = store.users.byName(name);
      if (user) {
        if (user.status === 'banned') return res.status(403).json({ error: 'Acesso negado pelo Mestre.' });
        if (user.password_hash && !bcrypt.compareSync(password, user.password_hash)) {
          return res.status(401).json({ error: 'Senha pessoal incorreta para este nome.' });
        }
      } else {
        if (spectator && !config.allowSpectators) return res.status(403).json({ error: 'Esta mesa não aceita espectadores.' });
        if (!spectator && password.length < 3) return res.status(400).json({ error: 'Crie uma senha pessoal com pelo menos 3 caracteres.' });
        user = store.users.create({
          name,
          passwordHash: password ? bcrypt.hashSync(password, 10) : null,
          role: spectator ? 'spectator' : 'player',
          status: (spectator || config.autoApprovePlayers) ? 'approved' : 'pending',
          color: nextColor()
        });
      }
      startSession(res, user);
      res.json({ user: publicUser(user) });
    });

    app.post('/api/logout', (req, res) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) store.sessions.remove(token);
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      res.json({ ok: true });
    });

    app.get('/api/me', (req, res) => {
      const user = userFromRequest(req);
      res.json({
        user: publicUser(user),
        tableName: config.tableName,
        system: config.system,
        needsTablePassword: !!config.tablePassword,
        allowSpectators: !!config.allowSpectators,
        gmName: config.gmName
      });
    });
  }

  // Middleware para rotas que exigem login.
  function requireUser(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Faça login.' });
    if (user.status !== 'approved') return res.status(403).json({ error: 'Aguardando aprovação do Mestre.' });
    req.user = user;
    next();
  }
  function requireGM(req, res, next) {
    requireUser(req, res, () => {
      if (req.user.role !== 'gm') return res.status(403).json({ error: 'Apenas o Mestre.' });
      next();
    });
  }

  return { registerRoutes, requireUser, requireGM, userFromToken, userFromRequest, parseCookies, COOKIE, publicUser };
}

module.exports = { createAuth, publicUser };
