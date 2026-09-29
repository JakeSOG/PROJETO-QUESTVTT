// Testes de integração do QuestVTT + DuskBloods (servidor real, sockets reais).
// Rodar: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'questvtt-test-'));
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
  port: 0, tableName: 'Teste', system: 'duskbloods', gmName: 'Mestre', gmPassword: 'gm',
  tablePassword: '', autoApprovePlayers: true, allowSpectators: true, uploadMaxMB: 5, backupKeep: 2, backupEveryMinutes: 0, chatHistory: 50
}));
process.env.QUESTVTT_CONFIG = path.join(tmp, 'config.json');
process.env.QUESTVTT_DATA = path.join(tmp, 'data');

const { start } = require('../server/index.js');
const dice = require('../server/dice.js');

let app, base, gm, pl;
const messages = [];

async function login(name, password) {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password }) });
  assert.equal(res.status, 200, await res.clone().text());
  return res.headers.get('set-cookie').split(';')[0];
}

function sock(cookie) {
  return new Promise((resolve, reject) => {
    const s = connect(base, { extraHeaders: { cookie }, transports: ['websocket'] });
    s.once('world:state', (st) => { s.state = st; resolve(s); });
    s.once('connect_error', reject);
  });
}

const emit = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const actorOf = (id) => app.ctx.store.actors.get(id);

before(async () => {
  app = start({ test: true, quiet: true, port: 0 });
  await new Promise(r => app.server.once('listening', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  gm = await sock(await login('Mestre', 'gm'));
  pl = await sock(await login('Edith', 'senha1'));
  gm.on('chat:message', (m) => messages.push(m));
});

after(async () => {
  dice.setTestRng(null);
  gm.close(); pl.close();
  await app.close();
});

let hunterId, sceneId, hunterToken, beastToken, beastId;

test('Mestre cria cena, caçador com kit inicial e vincula ao jogador', async () => {
  const sc = await emit(gm, 'scene:create', { name: 'Pátio' });
  sceneId = sc.scene.id;
  const playerId = pl.state.user.id;
  const r = await emit(gm, 'actor:create', { type: 'hunter', name: 'Edith', ownerId: playerId, data: { class: 'noctivus', kit: { weapon: 'lamina-simples', off: 'revolver' } } });
  assert.ok(r.actor, JSON.stringify(r));
  hunterId = r.actor.id;
  // Atributos e perícias
  const up = await emit(gm, 'actor:update', { id: hunterId, data: { attributes: { vigor: 3, agilidade: 4, intelecto: 1, percepcao: 3, vontade: 2 }, skills: { 'armas-ageis': 2, 'armas-pesadas': 1, 'armas-de-fogo': 2, resiliencia: 1 } } });
  assert.ok(up.actor);
  const a = up.actor;
  assert.equal(a.derived.hpMax, 9 + 3, 'Noctivus: Vida 9 + Vigor');
  assert.equal(a.derived.guardMax, 8);
  assert.equal(a.derived.limiar, 3);
  assert.equal(a.data.weapons.length, 1);
  assert.equal(a.data.revolvers.length, 1);
  assert.equal(a.data.flasks, 3);
});

test('/teste Vigor+Resiliência rola o pool correto da ficha', async () => {
  messages.length = 0;
  await emit(pl, 'chat:send', { text: '/teste Vigor+Resiliência 2', actorId: hunterId });
  await wait(100);
  const c = messages.find(m => m.data?.card === 'test');
  assert.ok(c, 'cartão de teste');
  assert.equal(c.data.pool.count, 4, 'Vigor 3 + Resiliência 1');
  assert.equal(c.data.pool.target, 2);
  // Apelido do prompt: "Resistência" → Resiliência
  messages.length = 0;
  await emit(pl, 'chat:send', { text: '/teste Vigor+Resistência', actorId: hunterId });
  await wait(100);
  assert.equal(messages.find(m => m.data?.card === 'test').data.pool.count, 4);
});

test('Pool: 5 e 6 são sucessos, 6 explode e soma', () => {
  const { rollPool } = require('../systems/duskbloods/server/pool.js');
  const core = app.ctx.system.rules.core;
  const seq = [6, 5, 2, 1, 3];
  let i = 0;
  dice.setTestRng(() => seq[i++ % seq.length]);
  const p = rollPool(3, core); // [6→5], [2], [1]
  dice.setTestRng(null);
  assert.deepEqual(p.chains, [[6, 5], [2], [1]]);
  assert.equal(p.successes, 2);
});

test('Dano de Truque NÃO é multiplicado pelo crítico', () => {
  const M = app.ctx.engine.mechanics;
  dice.setTestRng(() => 2);
  const dmg = M.computeDamage({ base: [{ dice: '1d6', type: 'Incisium' }], multiplier: 2, excess: 4, trick: [{ dice: '2d4', type: 'Incisium' }] });
  dice.setTestRng(null);
  // base 2×2 = 4, excedentes +4, truque 2+2 = 4 (sem multiplicar) → 12
  assert.equal(dmg.total, 12);
});

test('Tokens e combate: ataque com Gatilho gasta 1 PA extra e guarda o revólver (Duas Mãos)', async () => {
  const t = await emit(gm, 'token:create', { actorId: hunterId, x: 70, y: 70 });
  hunterToken = t.token.id;
  const sp = await emit(gm, 'actor:spawn', { pack: 'bestiary', ref: 'fera-de-duas-cabecas', x: 140, y: 70 });
  beastToken = sp.token.id; beastId = sp.actor.id;
  assert.equal(actorOf(beastId).data.limiar, 2);

  assert.ok((await emit(gm, 'combat:start', {})).ok);
  await emit(gm, 'combat:initiative', { mode: 'hunters' });
  await emit(gm, 'combat:begin', {});
  assert.equal(actorOf(hunterId).data.pa.value, 6);

  dice.setTestRng(() => 3); // tudo falha — só queremos verificar custos
  const r = await emit(pl, 'sys:action', { action: 'attack', actorId: hunterId, weapon: actorOf(hunterId).data.equip.main, mode: 'basic', trigger: true, targets: [beastToken] });
  dice.setTestRng(null);
  assert.ok(r.ok, JSON.stringify(r));
  const d = actorOf(hunterId).data;
  assert.equal(d.weapons[0].form, 'truque');
  assert.equal(d.pa.value, 6 - (1 + 3), 'Gatilho 1 + Espada Longa (Pesada) 3');
  assert.equal(d.equip.offStowed, true, 'revólver guardado automaticamente');
});

test('Ataque Pesado não pode acompanhar troca de forma', async () => {
  const r = await emit(pl, 'sys:action', { action: 'attack', actorId: hunterId, weapon: actorOf(hunterId).data.equip.main, mode: 'heavy', trigger: true, targets: [beastToken] });
  assert.match(r.error, /Gatilho/);
});

test('Contra-Tiro aparece para o alvo e aplica Fractura ao acertar', async () => {
  // Volta a arma para Uma Mão e saca o revólver (fora do fluxo de PA: Mestre)
  const d = actorOf(hunterId).data;
  await emit(gm, 'actor:update', { id: hunterId, data: { weapons: d.weapons.map(w => ({ ...w, form: 'padrao' })), equip: { offStowed: false }, pa: { value: 8 } } });
  await emit(gm, 'combat:next', {}); // turno das criaturas (caçador recupera PA só no turno dele)
  await emit(gm, 'actor:update', { id: hunterId, data: { pa: { value: 8 } } });

  let offered = null;
  pl.once('sys:reaction', (p) => { offered = p; pl.emit('sys:react', { id: p.id, use: true }, () => {}); });
  dice.setTestRng(() => 5); // todo dado é sucesso (sem explodir)
  const r = await emit(gm, 'sys:action', { action: 'creatureAttack', actorId: beastId, attackIndex: 0, targets: [hunterToken] });
  dice.setTestRng(null);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(offered, 'oferta de Contra-Tiro enviada ao jogador');
  assert.equal(offered.cost, 4);
  const beast = actorOf(beastId).data;
  assert.ok(beast.states.some(s => s.id === 'fractura'), 'criatura em Fractura');
  assert.equal(beast.pa.value, 0, 'criatura em Fractura perde o PA');
  const h = actorOf(hunterId).data;
  assert.equal(h.pa.value, 4, '8 - 4 do Contra-Tiro');
  assert.equal(h.revolvers[0].ammo, 5);
  assert.equal(h.hp.value, 12, 'golpe interrompido: sem dano');
});

test('Alterar um número nos JSON muda o comportamento sem mexer no código', async () => {
  const rules = app.ctx.system.rules;
  const old = rules.combat.limiarBase;
  rules.combat.limiarBase = 5;
  const r = await emit(pl, 'sys:action', { action: 'derived', actorId: hunterId });
  assert.equal(r.derived.limiar, 5);
  rules.combat.limiarBase = old;
});

test('Estados: dano contínuo no início do turno e duração em rodadas', async () => {
  await emit(gm, 'sys:action', { action: 'state', actorId: beastId, state: 'ardens' });
  const hpBefore = actorOf(beastId).data.hp.value;
  await emit(gm, 'combat:next', {}); // rodada 2, caçadores
  await emit(gm, 'combat:next', {}); // criaturas: Ardens queima
  const b = actorOf(beastId).data;
  assert.ok(b.hp.value < hpBefore, 'Ardens causou dano');
});

test('Morte: Ecos vão para um cadáver no mapa', async () => {
  await emit(gm, 'actor:update', { id: hunterId, data: { ecos: 42, dementia: 0 } });
  const r = await emit(gm, 'sys:action', { action: 'death', actorId: hunterId });
  assert.ok(r.ok, JSON.stringify(r));
  const h = actorOf(hunterId).data;
  assert.equal(h.ecos, 0);
  assert.equal(h.dementia, 5);
  const corpse = app.ctx.store.tokens.list(sceneId).find(t => t.data.disposition === 'corpse');
  assert.ok(corpse);
  assert.equal(corpse.data.ecos, 42);
});

test('Permissões: jogador não edita ficha alheia nem move token da criatura', async () => {
  const r = await emit(pl, 'actor:update', { id: beastId, data: { hp: { value: 1 } } });
  assert.match(r.error, /própria/);
  const m = await emit(pl, 'token:move', { id: beastToken, x: 0, y: 0 });
  assert.ok(m.error);
});
