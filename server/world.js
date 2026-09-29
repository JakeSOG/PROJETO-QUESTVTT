// "Mundo": visões filtradas por permissão e difusão de mudanças para os clientes.
// Regra de ouro: o servidor decide o que cada pessoa pode ver.

function createWorld({ store, rt, config, getEngine }) {
  const isGM = (u) => u && u.role === 'gm';

  const world = {
    isGM,

    canControlActor(user, actor) {
      if (!user || !actor) return false;
      if (isGM(user)) return true;
      return user.role === 'player' && actor.owner_id === user.id;
    },

    canSeeToken(user, token) {
      return isGM(user) || !token.data.hidden;
    },

    canMoveToken(user, token) {
      if (isGM(user)) return true;
      if (user.role !== 'player' || !token.actor_id) return false;
      const actor = store.actors.get(token.actor_id);
      return !!actor && actor.owner_id === user.id;
    },

    // Mensagem de chat visível para este usuário?
    messageVisible(msg, user) {
      if (isGM(user)) return true;
      if (msg.blind) return false;
      if (Array.isArray(msg.whisper_to) && msg.whisper_to.length) {
        return msg.user_id === user.id || msg.whisper_to.includes(user.id);
      }
      return true;
    },

    messageView(msg, user) {
      if (!world.messageVisible(msg, user)) return undefined;
      const author = msg.user_id ? store.users.get(msg.user_id) : null;
      const data = { ...msg.data };
      // Dados privados do Mestre dentro de cartões (ex.: dano exato em criatura oculta).
      if (!isGM(user) && data.gmOnly) delete data.gmOnly;
      return {
        id: msg.id, type: msg.type, content: msg.content, data,
        whisper: Array.isArray(msg.whisper_to) && msg.whisper_to.length > 0,
        whisperNames: Array.isArray(msg.whisper_to) ? msg.whisper_to.map(id => store.users.get(id)?.name).filter(Boolean) : [],
        blind: !!msg.blind,
        author: author ? { id: author.id, name: author.name, color: author.color, role: author.role } : null,
        created_at: msg.created_at
      };
    },

    // Ficha: dono e Mestre veem tudo; os demais recebem a visão pública do sistema.
    actorView(actor, user) {
      if (!actor) return undefined;
      const engine = getEngine();
      if (world.canControlActor(user, actor)) {
        const decorated = engine && engine.decorate ? engine.decorate(actor) : actor;
        return { ...decorated, full: true };
      }
      const data = engine && engine.publicActorData ? engine.publicActorData(actor, user) : {};
      return { id: actor.id, type: actor.type, name: actor.name, img: actor.img, owner_id: actor.owner_id, data, full: false };
    },

    tokenView(token, user) {
      if (!world.canSeeToken(user, token)) return undefined;
      return token;
    },

    journalVisible(entry, user) {
      if (isGM(user)) return true;
      const vis = entry.data.visibility || 'gm';
      if (vis === 'all') return true;
      if (vis === 'users') return (entry.data.users || []).includes(user.id);
      return false;
    },

    journalView(entry, user) {
      if (!world.journalVisible(entry, user)) return undefined;
      if (isGM(user)) return entry;
      // Notas ocultas do Mestre nunca saem do servidor para jogadores.
      const { gmNotes, ...data } = entry.data || {};
      return { ...entry, data };
    },

    // Cena que um usuário está vendo (Mestre pode "espiar" outra cena).
    viewedSceneId(socket) {
      if (isGM(socket.data.user) && socket.data.viewSceneId) return socket.data.viewSceneId;
      return store.scenes.active()?.id ?? null;
    },

    // Pacote completo de uma cena para um usuário.
    sceneBundle(sceneId, user) {
      const scene = store.scenes.get(sceneId);
      if (!scene) return null;
      const tokens = store.tokens.list(sceneId).map(t => world.tokenView(t, user)).filter(Boolean);
      const walls = store.walls.list(sceneId);
      const lights = store.lights.list(sceneId).filter(l => isGM(user) || !l.data.hidden);
      const fog = store.fog.get(sceneId);
      return { scene, tokens, walls, lights, fog };
    },

    // ---------- Difusão ----------
    broadcastActor(actor) {
      rt.emitFiltered('actor:update', (u) => world.actorView(actor, u));
    },
    broadcastActorDelete(id) {
      rt.emitAll('actor:delete', { id });
    },

    // Envia algo apenas para quem está vendo a cena.
    emitScene(sceneId, event, fn) {
      for (const s of rt.sockets()) {
        if (s.data.user.status !== 'approved') continue;
        if (world.viewedSceneId(s) !== sceneId) continue;
        const p = typeof fn === 'function' ? fn(s.data.user, s) : fn;
        if (p !== undefined) s.emit(event, p);
      }
    },

    broadcastToken(token) {
      world.emitScene(token.scene_id, 'token:update', (u) => {
        if (world.canSeeToken(u, token)) return token;
        // Token ficou oculto: remove da tela de quem não pode vê-lo.
        return undefined;
      });
      // Quem não pode ver recebe remoção (caso tenha ficado oculto agora).
      if (token.data.hidden) {
        world.emitScene(token.scene_id, 'token:delete', (u) => isGM(u) ? undefined : { id: token.id });
      }
    },

    sendSceneTo(socket) {
      const sceneId = world.viewedSceneId(socket);
      socket.emit('scene:load', sceneId ? world.sceneBundle(sceneId, socket.data.user) : null);
    },

    // Recarrega a cena para todos que a veem (após ativar/alterar fundo, etc.).
    reloadSceneForViewers(sceneId) {
      for (const s of rt.sockets()) {
        if (s.data.user.status !== 'approved') continue;
        if (sceneId == null || world.viewedSceneId(s) === sceneId) world.sendSceneTo(s);
      }
    },

    postMessage(msg) {
      rt.emitFiltered('chat:message', (u) => world.messageView(msg, u));
    },
    // Reenvia uma mensagem alterada (ex.: botão de cartão já usado).
    updateMessage(msg) {
      rt.emitFiltered('chat:update', (u) => world.messageView(msg, u));
    },

    // Mensagem de sistema simples (texto) — opcionalmente só para alguns.
    systemMessage(content, { whisperTo = null, blind = false, data = {} } = {}) {
      const msg = store.chat.add({ user_id: null, type: 'system', content, data, whisper_to: whisperTo, blind });
      world.postMessage(msg);
      return msg;
    },

    combatState(user) {
      const combat = store.combat.active();
      if (!combat) return null;
      const combatants = store.combat.combatants(combat.id).filter(c => {
        if (isGM(user)) return true;
        const tok = c.token_id ? store.tokens.get(c.token_id) : null;
        return !tok || !tok.data.hidden;
      });
      return { ...combat, combatants };
    },
    broadcastCombat() {
      rt.emitFiltered('combat:update', (u) => world.combatState(u));
    },

    usersState() {
      const online = new Set(rt.onlineUsers().map(u => u.id));
      return store.users.list().map(u => ({ ...u, online: online.has(u.id) }));
    },
    broadcastUsers() {
      const all = world.usersState();
      rt.emitFiltered('users:update', (u) => isGM(u) ? all : all.filter(x => x.status === 'approved').map(({ id, name, role, color, online }) => ({ id, name, role, color, online })));
    }
  };
  return world;
}

module.exports = { createWorld };
