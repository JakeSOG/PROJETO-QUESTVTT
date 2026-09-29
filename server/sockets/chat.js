// Chat e comandos: /r, /gm, /w, /tabela, /ajuda. Comandos do sistema (ex.: /teste, /ataque)
// são delegados ao motor do sistema de jogo.
const { rollFormula } = require('../dice');

const HELP = [
  '<b>/r 2d6+1</b> — rolagem livre (soma)',
  '<b>/gm 2d6</b> — rolagem oculta (só o Mestre vê)',
  '<b>/w Nome mensagem</b> — sussurro',
  '<b>/me ação</b> — narração em terceira pessoa',
  '<b>/tabela nome</b> — rola numa tabela aleatória',
  '<b>/limpar</b> — (Mestre) apaga o chat'
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function register(ctx) {
  const { on, store, world, fail, socket } = ctx;

  function post(fields) {
    const msg = store.chat.add(fields);
    world.postMessage(msg);
    return msg;
  }

  // Descobre o ator "falante" (ficha controlada do usuário ou token selecionado).
  function speaker(user, actorId) {
    if (actorId) {
      const a = store.actors.get(Number(actorId));
      if (a && world.canControlActor(user, a)) return a;
    }
    return store.actors.list().find(a => a.owner_id === user.id) || null;
  }

  function rollTable(name, user, blind) {
    const key = String(name || '').trim().toLowerCase();
    const sys = ctx.system.compendium.tables?.entries || [];
    const custom = store.rolltables.list().map(t => ({ id: `u${t.id}`, name: t.name, dice: t.data.dice, results: t.data.results }));
    const table = [...sys, ...custom].find(t => t.id === key || t.name.toLowerCase() === key || t.name.toLowerCase().includes(key));
    if (!table) fail('Tabela não encontrada.');
    let formula = table.dice || `1d${table.results.length}`;
    const roll = rollFormula(formula);
    const hit = table.results.find(r => r.range ? roll.total >= r.range[0] && roll.total <= r.range[1] : false)
      || table.results[(roll.total - 1) % table.results.length];
    return post({
      user_id: user.id, type: 'table',
      content: '',
      data: { table: table.name, roll, result: hit ? hit.text : '—' },
      blind
    });
  }

  on('chat:send', async ({ text, actorId, targets }, user) => {
    text = String(text || '').trim().slice(0, 2000);
    if (!text) return;
    if (user.role === 'spectator' && text.startsWith('/') && !text.startsWith('/w')) fail('Espectadores não rolam dados.');

    if (!text.startsWith('/')) {
      const a = speaker(user, actorId);
      return void post({ user_id: user.id, type: 'text', content: escapeHtml(text), data: { speaker: a ? a.name : null } });
    }

    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(' ');

    switch (cmd) {
      case '/r': case '/roll': case '/rolar': {
        const roll = rollFormula(arg || '1d6');
        if (!roll) fail('Fórmula inválida. Ex.: /r 2d6+1');
        return void post({ user_id: user.id, type: 'roll', content: '', data: { roll } });
      }
      case '/gm': case '/gmr': case '/oculta': {
        // "/gm teste Vigor+Resiliência" também funciona: delega ao sistema como rolagem oculta.
        const sub = rest[0] ? '/' + rest[0].toLowerCase() : '';
        if (sub && ctx.engine && ctx.engine.commands && ctx.engine.commands[sub]) {
          return void (await ctx.engine.commands[sub]({ arg: rest.slice(1).join(' '), user, actorId, targets, blind: true, post, socket }));
        }
        const roll = rollFormula(arg || '1d6');
        if (!roll) fail('Fórmula inválida. Ex.: /gm 2d6');
        return void post({ user_id: user.id, type: 'roll', content: '', data: { roll }, blind: true });
      }
      case '/w': case '/sussurro': {
        const target = rest[0] ? store.users.list().find(u => u.name.toLowerCase() === rest[0].toLowerCase()) : null;
        if (!target) fail('Jogador não encontrado. Use /w Nome mensagem');
        const body = rest.slice(1).join(' ');
        if (!body) fail('Mensagem vazia.');
        return void post({ user_id: user.id, type: 'whisper', content: escapeHtml(body), whisper_to: [target.id], data: { to: target.name } });
      }
      case '/me': case '/em': {
        const a = speaker(user, actorId);
        return void post({ user_id: user.id, type: 'emote', content: escapeHtml(arg), data: { speaker: a ? a.name : user.name } });
      }
      case '/tabela': case '/table':
        return void rollTable(arg, user, false);
      case '/limpar': case '/clear':
        if (user.role !== 'gm') fail('Apenas o Mestre.');
        store.chat.clear();
        ctx.rt.emitAll('chat:cleared', {});
        return;
      case '/ajuda': case '/help': {
        const sysHelp = ctx.engine && ctx.engine.help ? ctx.engine.help : [];
        return void world.systemMessage([...HELP, ...sysHelp].join('<br>'), { whisperTo: [user.id] });
      }
      default: {
        if (ctx.engine && ctx.engine.commands && ctx.engine.commands[cmd]) {
          return void (await ctx.engine.commands[cmd]({ arg, user, actorId, targets, blind: false, post, socket }));
        }
        fail(`Comando desconhecido: ${cmd}. Digite /ajuda.`);
      }
    }
  });

  on('chat:rollTable', ({ id, blind }, user) => { rollTable(id, user, !!blind && user.role === 'gm'); }, { player: true });

  on('chat:delete', ({ id }) => {
    store.chat.remove(Number(id));
    ctx.rt.emitAll('chat:delete', { id: Number(id) });
  }, { gm: true });

  // Mestre revela uma rolagem oculta para todos.
  on('chat:reveal', ({ id }) => {
    const msg = store.chat.get(Number(id));
    if (!msg) fail('Mensagem não encontrada.');
    store.db.prepare('UPDATE chat_messages SET blind = 0 WHERE id = ?').run(msg.id);
    const updated = store.chat.get(msg.id);
    ctx.rt.emitAll('chat:delete', { id: msg.id });
    world.postMessage(updated);
  }, { gm: true });
}

module.exports = { register, escapeHtml };
