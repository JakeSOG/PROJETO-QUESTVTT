// Motor do sistema DuskBloods. LÊ as regras dos JSON e APLICA nas fichas.
// Fluxos automatizados: testes, ataques com TOC, Contra-Tiro, Arcanos, Marcas,
// estados com duração, dano contínuo, Guarda/Fractura, morte e velas.
const { createModel } = require('./model');
const { createMechanics } = require('./mechanics');

function createEngine(ctx) {
  const { store, world, rt, system } = ctx;
  const model = createModel(system);
  const M = createMechanics(system, model);
  const R = () => system.rules;
  const IDX = () => system.index;
  const pending = new Map(); // reações pendentes (Contra-Tiro)

  const fail = (msg) => { throw M.userError(msg); };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ================================================================
  // Acesso a atores e combate
  // ================================================================
  function getActor(id) {
    const a = store.actors.get(Number(id));
    if (!a) fail('Ficha não encontrada.');
    return model.normalize(a);
  }

  // Salva os dados inteiros do ator e avisa todos.
  function save(actor) {
    const updated = store.actors.update(actor.id, { data: actor.data }, true);
    world.broadcastActor(updated);
    return updated;
  }

  function combatStatus(actor) {
    const combat = store.combat.active();
    if (!combat || !combat.data.started) return { inCombat: false, combat, round: null, side: null };
    const combatant = store.combat.combatants(combat.id).find(c => c.actor_id === actor.id);
    return { inCombat: !!combatant, combat, combatant, round: combat.data.round, side: combat.data.side };
  }

  function stateCtx(cs) { return cs && cs.combat && cs.combat.data.started ? { round: cs.combat.data.round, side: cs.combat.data.side } : {}; }

  function ensureControl(user, actor) {
    if (!world.canControlActor(user, actor)) fail('Você não controla esta ficha.');
  }

  // Pode agir agora? (turno do lado, Fractura, Morrendo)
  function ensureCanAct(user, actor, cs, { reaction = false } = {}) {
    if (user.role === 'gm') return;
    const d = actor.data;
    if (M.hasState(d, 'morrendo')) fail('Seu caçador está Morrendo.');
    if (!cs.inCombat || reaction) return;
    if (cs.combatant.data.side !== cs.side) fail('Não é o turno do seu lado.');
    if (M.hasState(d, 'fractura')) fail('Em Fractura: você perdeu este turno.');
  }

  // Gasta PA (somente em combate). Fulguratio limita o gasto no turno.
  function payPa(d, cost, cs, label = 'ação') {
    if (!cs.inCombat || cost <= 0) return 0;
    const pa = d.pa?.value ?? 0;
    if (pa < cost) fail(`PA insuficiente para ${label}: precisa de ${cost}, tem ${pa}.`);
    const cap = (d.states || []).map(s => model.stateDef(s.id)?.modifiers?.paSpendCap).filter(Boolean);
    if (cap.length && ((d.turn?.paSpent || 0) + cost) > Math.min(...cap)) fail(`Fulguratio: não pode gastar mais de ${Math.min(...cap)} PA neste turno.`);
    d.pa = { ...(d.pa || {}), value: pa - cost };
    d.turn = { ...(d.turn || {}), paSpent: (d.turn?.paSpent || 0) + cost };
    return cost;
  }

  function tokensOf(ids) {
    return (Array.isArray(ids) ? ids : []).map(id => store.tokens.get(Number(id))).filter(t => t && t.actor_id)
      .map(t => ({ token: t, actor: model.normalize(store.actors.get(t.actor_id)) })).filter(x => x.actor);
  }

  function tokenOfActor(actor) {
    const scene = store.scenes.active();
    const list = store.db.prepare('SELECT id FROM tokens WHERE actor_id = ?').all(actor.id).map(r => store.tokens.get(r.id));
    return list.find(t => scene && t.scene_id === scene.id) || list[0] || null;
  }

  // Distância em metros entre dois tokens (centro a centro, em quadrados de grade).
  function distance(tokA, tokB) {
    if (!tokA || !tokB || tokA.scene_id !== tokB.scene_id) return null;
    const scene = store.scenes.get(tokA.scene_id);
    const g = scene.data.grid;
    const ca = { x: tokA.data.x + g.size * (tokA.data.size || 1) / 2, y: tokA.data.y + g.size * (tokA.data.size || 1) / 2 };
    const cb = { x: tokB.data.x + g.size * (tokB.data.size || 1) / 2, y: tokB.data.y + g.size * (tokB.data.size || 1) / 2 };
    const dx = Math.abs(ca.x - cb.x) / g.size, dy = Math.abs(ca.y - cb.y) / g.size;
    return Math.round(Math.max(dx, dy) * g.units * 10) / 10;
  }

  // ================================================================
  // Cartões de chat
  // ================================================================
  function card(user, data, { blind = false, whisperTo = null } = {}) {
    const msg = store.chat.add({ user_id: user ? user.id : null, type: 'sys', content: '', data, whisper_to: whisperTo, blind });
    world.postMessage(msg);
    return msg;
  }

  function poolView(pool, ev, parts) {
    return {
      count: pool.count, chains: pool.chains, successes: pool.successes,
      critFail: pool.critFail, parts,
      target: ev ? ev.target : null, passed: ev ? ev.passed : null, excess: ev ? ev.excess : 0,
      critical: ev ? ev.critical : false, criticalFailure: ev ? ev.criticalFailure : false
    };
  }

  function autoApply() { return store.settings.get('duskbloods.autoApply', true); }

  // ================================================================
  // Testes
  // ================================================================
  function doTest(user, actor, { attribute, skill, difficulty = null, bonus = 0, label, blind = false }) {
    if (actor.type !== 'hunter') {
      const d = clone(actor.data);
      const p = M.creaturePool(d, { bonus });
      const pool = M.roll(p.count);
      const ev = difficulty != null ? M.judge(pool, difficulty) : null;
      actor.data = d; save(actor);
      return card(user, { card: 'test', title: label || 'Rolagem', actor: actor.name, actorId: actor.id, pool: poolView(pool, ev, p.parts) }, { blind });
    }
    const d = clone(actor.data);
    const p = M.hunterPool(d, attribute, skill, { bonus });
    const pool = M.roll(p.count);
    const ev = difficulty != null ? M.judge(pool, Number(difficulty)) : null;
    actor.data = d;
    save(actor);
    const title = label || [attribute && M.attrName(attribute), skill && M.skillName(skill)].filter(Boolean).join(' + ');
    return card(user, { card: 'test', title, actor: actor.name, actorId: actor.id, pool: poolView(pool, ev, p.parts) }, { blind });
  }

  // Teste de Sanidade com ganho automático de Dementia na falha.
  function doSanity(user, actor, { difficulty = 2, bonus = 0, blind = false, label }) {
    if (actor.type !== 'hunter') fail('Apenas caçadores fazem testes de Sanidade.');
    const d = clone(actor.data);
    const dm = R().dementia;
    const dv = model.derivedHunter(d);
    const extra = dv.sanityDice ? [{ dice: dv.sanityDice, label: `Resistência a Dementia +${dv.sanityDice}` }] : [];
    const p = M.hunterPool(d, dm.sanityRoll[0], dm.sanityRoll[1], { bonus, extraParts: extra });
    const pool = M.roll(p.count);
    const ev = M.judge(pool, Number(difficulty));
    const notes = [];
    let gain = 0;
    if (!ev.passed) {
      gain = ev.criticalFailure ? dm.onSanityCriticalFail : dm.onSanityFail;
      const before = d.dementia || 0;
      d.dementia = Math.min(dm.max, before + gain);
      notes.push(`+${gain} Dementia (${before} → ${d.dementia})`);
      notes.push(...stageNotes(d, before, d.dementia));
    }
    actor.data = d;
    save(actor);
    const difName = dm.sanityDifficulties.find(x => x.successes === Number(difficulty))?.name;
    return card(user, { card: 'test', kind: 'sanity', title: label || `Sanidade${difName ? ` (${difName})` : ''}`, actor: actor.name, actorId: actor.id, pool: poolView(pool, ev, p.parts), notes }, { blind });
  }

  // Avisos de mudança de estágio de Dementia (mutações, Ascensão).
  function stageNotes(d, before, after) {
    const notes = [];
    const sb = model.dementiaStage(before), sa = model.dementiaStage(after);
    if (sa.id !== sb.id && after > before) {
      notes.push(`<b>Estágio da Dementia: ${sa.name}.</b> ${sa.text}`);
      if (sa.mutation && !(d.mutationGrades || []).includes(sa.mutation)) {
        d.mutationGrades = [...(d.mutationGrades || []), sa.mutation];
        const grade = R().dementia.mutationGrades.find(g => g.id === sa.mutation);
        notes.push(`🩸 O parasita se acomoda: escolha uma <b>Mutação ${grade ? grade.name : sa.mutation}</b> (a ficha avisa).`);
      }
      if (sa.id === 'ascensao') notes.push('☠ <b>ASCENSÃO.</b> O parasita venceu. O caçador passa às mãos do Mestre.');
    }
    return notes;
  }

  function discernmentNotes(before, after) {
    const disc = R().discernment;
    const notes = [];
    for (let m = before + 1; m <= after; m++) {
      if (m % disc.milestoneEvery !== 0) continue;
      const rewards = [`${disc.choiceEachMilestone}`, `+${disc.hpPerMilestone} de Vida`];
      if (disc.talentsAt.includes(m)) rewards.push('um Talento');
      if (disc.attributePointAt.includes(m)) rewards.push('+1 ponto de atributo');
      if (disc.skillLevelAt.includes(m)) rewards.push('+1 nível de perícia');
      if (disc.sanityDiceAt.includes(m)) rewards.push('+1 dado em testes de Sanidade');
      if (disc.extraSpellSlotAt.includes(m)) rewards.push('+1 Espaço de Magia');
      notes.push(`👁 <b>Marco de Discernimento ${m}</b>: ${rewards.join(', ')}. Pode tentar Sanidade Difícil para reduzir 2 de Dementia.`);
    }
    return notes;
  }

  // ================================================================
  // Ataque do CAÇADOR (armas TOC, revólveres, desarmado, mordidas de mutação)
  // ================================================================
  async function hunterAttack(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    if (actor.type !== 'hunter') fail('Use o ataque de criatura.');
    const cs = combatStatus(actor);
    ensureCanAct(user, actor, cs);
    const d = clone(actor.data);
    const rc = R().combat;
    const mode = ['basic', 'heavy', 'visceral', 'abate'].includes(p.mode) ? p.mode : 'basic';
    const targets = tokensOf(p.targets);
    const myToken = tokenOfActor(actor);
    const notes = [];
    if (d.defense && rc.defenses.find(x => x.id === d.defense.id)?.noAttack) fail('Em Defesa Total você não pode atacar até o próximo turno.');

    // ---- Fonte do ataque ----
    let src;
    if (p.weapon === 'unarmed') {
      const mods = model.modifiers(d, 'hunter');
      src = { kind: 'unarmed', name: 'Desarmado', category: 'agil', damage: mods.unarmedDamage || (mods.unarmedDice ? [{ dice: mods.unarmedDice, type: 'Contusio' }] : rc.attacks.unarmed.damage) };
    } else if (String(p.weapon || '').startsWith('mutation:')) {
      const mut = IDX().mutations[String(p.weapon).slice(9)];
      if (!mut || !mut.attack || !(d.mutations || []).includes(mut.id)) fail('Mutação sem ataque.');
      src = { kind: 'mutation', name: mut.attack.name, damage: mut.attack.damage, roll: mut.attack.roll, pa: mut.attack.pa, applyStates: mut.attack.applyStates };
    } else {
      const found = model.findItem(d, p.weapon || d.equip.main);
      if (!found) fail('Arma não encontrada na ficha.');
      if (found.kind === 'channeler') fail('Canalizadores não atacam: use um Arcano.');
      if (found.kind === 'revolver') {
        const ref = model.revolverRef(found.inst);
        const h = model.hands(d);
        if (!(h.offReady && d.equip.off === found.inst.uid)) fail(`${ref.name} não está em mãos. Saque-o (1 PA).`);
        src = { kind: 'revolver', inst: found.inst, ref, name: ref.name, category: 'disparo', damage: ref.damage };
      } else {
        const ref = model.weaponRef(found.inst);
        if (d.equip.main !== found.inst.uid) fail(`${ref.name} não está empunhada.`);
        if (d.equip.mainStowed) fail(`${ref.name} está guardada. Saque-a (1 PA).`);
        src = { kind: 'weapon', inst: found.inst, ref };
      }
    }

    // ---- Gatilho da Oficina (troca de forma junto do ataque) ----
    let triggerCost = 0;
    if (p.trigger) {
      if (src.kind !== 'weapon') fail('Só armas TOC têm Gatilho da Oficina.');
      if (mode !== 'basic') fail('O Gatilho só acompanha um Ataque Básico (nunca Pesado ou Visceral).');
      const mods = model.modifiers(d, 'hunter');
      triggerCost = rc.attacks.triggerCost;
      if (cs.inCombat && mods.firstTriggerFree && !d.combatFlags?.firstTriggerUsed) {
        triggerCost = 0;
        d.combatFlags = { ...(d.combatFlags || {}), firstTriggerUsed: true };
        notes.push('Engenho da Oficina: troca sem custo.');
      }
      const tr = transformWeapon(d, src.inst, notes);
      if (tr.selfDamage) {
        const res = M.dealDamage('hunter', d, tr.selfDamage.amount);
        notes.push(`${src.ref.name}: ${res.dealt} de dano ${tr.selfDamage.type} em si mesmo.`);
      }
    }
    if (src.kind === 'weapon') {
      const form = src.ref.forms[src.inst.form];
      src.form = form;
      src.name = `${src.ref.name} — ${form.name}`;
      src.category = form.category;
      src.damage = form.damage;
      src.trick = form.trick || [];
    }

    const ranged = src.category === 'disparo';
    if (mode === 'heavy' && (ranged || src.kind === 'unarmed' || src.kind === 'revolver' || src.kind === 'mutation')) fail('Ataque Pesado só com armas corpo a corpo.');
    if (mode === 'abate' && !(src.kind === 'revolver' || (src.form && src.form.ranged))) fail('Tiro de Abate exige um disparo.');
    if (mode === 'abate' && cs.inCombat) fail('Tiro de Abate só acontece fora de um combate formal.');

    // ---- Custo em PA ----
    let cost;
    if (mode === 'visceral') {
      const target = targets[0];
      if (!target) fail('Escolha o alvo do Ataque Visceral.');
      const fractured = M.hasState(target.actor.data, 'fractura');
      let usedFury = false;
      if (!fractured && !p.stealth) {
        const cls = model.classDef(d);
        const maxFury = (cls.passive?.usesPerCombat || 0) + ((d.talents || []).includes('carne-inquebravel') ? 1 : 0);
        if (cls.id === 'cruentaris' && d.combatFlags?.attackedInTrick && (d.combatFlags?.fury || 0) < maxFury) {
          usedFury = true;
          d.combatFlags = { ...d.combatFlags, fury: (d.combatFlags?.fury || 0) + 1 };
          notes.push('Fúria Encouraçada: Visceral sem exigir Fractura.');
        } else fail('O alvo precisa estar em Fractura (ou desprevenido / você sob Latens — marque "furtivo").');
      }
      cost = (fractured || usedFury) ? rc.visceral.costFracture : rc.visceral.costStealth;
      if (src.form?.effects?.visceralDiscount) cost = Math.max(1, cost - src.form.effects.visceralDiscount);
      const vc = d.combatFlags?.visceral?.[target.actor.id] || 0;
      if (cs.inCombat && vc >= rc.visceral.maxPerTargetPerCombat) fail(`Limite de ${rc.visceral.maxPerTargetPerCombat} Ataques Viscerais contra esta criatura neste combate.`);
      if (cs.inCombat) d.combatFlags = { ...(d.combatFlags || {}), visceral: { ...(d.combatFlags?.visceral || {}), [target.actor.id]: vc + 1 } };
    } else if (src.kind === 'unarmed') {
      cost = rc.attacks.unarmed.pa + rc.attacks.unarmed.extraPerUse * (d.turn?.unarmed || 0);
    } else if (src.kind === 'mutation') {
      cost = src.pa || 2;
    } else if (src.kind === 'revolver') {
      cost = src.ref.pa;
    } else {
      cost = rc.attacks.basic[ranged ? 'agil' : src.category];
      if (mode === 'heavy') cost += rc.attacks.heavyExtraPa;
      const disc = src.form.effects?.secondAttackDiscount;
      if (disc && (d.turn?.attacks || 0) >= 1) { cost = Math.max(1, cost - disc); notes.push(`Ataques seguidos: -${disc} PA.`); }
    }
    const totalCost = cost + triggerCost;

    // ---- Munição ----
    let ammoNote = null;
    if (src.kind === 'revolver' || (src.form && src.form.ranged)) {
      const inst = src.inst;
      const per = src.ref.ammoPerAction || 1;
      if ((inst.ammo ?? 0) < per) fail('Sem munição. Recarregue (1 PA).');
      inst.ammo -= per;
      ammoNote = `Munição: ${inst.ammo}`;
      if (src.kind === 'revolver') { const rv = d.revolvers.find(x => x.uid === inst.uid); rv.ammo = inst.ammo; }
    }

    payPa(d, totalCost, cs, 'o ataque');

    // ---- Rolagem ----
    let rollDef;
    if (src.kind === 'mutation') rollDef = src.roll;
    else if (src.kind === 'unarmed') rollDef = [rc.attacks.unarmed.attribute, rc.attacks.unarmed.skill];
    else rollDef = rc.attacks.formSkill[src.category];
    const extra = [];
    const mods = model.modifiers(d, 'hunter');
    if (src.kind === 'unarmed' && mods.unarmedAdvantage) extra.push({ dice: 1, label: 'Briguento +1' });
    if (src.kind === 'revolver' && src.ref.bonusDiceAtRange && targets[0]) {
      const dist = distance(myToken, targets[0].token);
      if (dist != null && dist >= src.ref.bonusDiceAtRange.min) extra.push({ dice: src.ref.bonusDiceAtRange.dice, label: `Precisão (${dist} m) +1` });
    }
    if (mode === 'abate' && src.ref?.killShotBonusDice) extra.push({ dice: src.ref.killShotBonusDice, label: 'Silencioso +1' });
    if (targets[0] && d.combatFlags?.advantageVs?.[targets[0].actor.id]) {
      extra.push({ dice: 1, label: 'Passo da Névoa +1' });
      const adv = { ...d.combatFlags.advantageVs }; delete adv[targets[0].actor.id];
      d.combatFlags = { ...d.combatFlags, advantageVs: adv };
    }
    if (src.kind === 'revolver' && src.ref.maxRange && targets[0]) {
      const dist = distance(myToken, targets[0].token);
      if (dist != null && dist > src.ref.maxRange) notes.push(`⚠ ${src.ref.name} só funciona a até ${src.ref.maxRange} m (alvo a ${dist} m).`);
    }

    let pool = null, poolInfo = null;
    if (mode !== 'visceral') {
      poolInfo = M.hunterPool(d, rollDef[0], rollDef[1], { bonus: Number(p.bonusDice) || 0, extraParts: extra });
      pool = M.roll(poolInfo.count);
    }

    // ---- Resolução por alvo ----
    const results = [];
    const shots = src.ref?.shots || 1;
    for (const t of targets) {
      const tgt = t.actor;
      tgt.data = clone(tgt.data);
      const lim = M.limiarOf(tgt, { cover: Number(p.cover) || 0 });
      let ev;
      if (mode === 'visceral') ev = { target: lim.value, passed: true, excess: 0, critical: false, criticalFailure: false };
      else ev = M.judge(pool, lim.value);
      const r = { targetId: t.token.id, targetActorId: tgt.id, targetName: t.token.data.name || tgt.name, limiar: lim.value, limiarParts: lim.parts, passed: ev.passed, excess: ev.excess, critical: ev.critical, criticalFailure: ev.criticalFailure, visceral: mode === 'visceral', notes: [] };
      if (!ev.passed) {
        // Passo da Névoa não se aplica aqui (é o caçador errando).
        results.push(r);
        save(tgt);
        continue;
      }
      // Dano
      const multiplier = mode === 'visceral' ? rc.visceral.damageMultiplier : (ev.critical ? R().core.criticalDamageMultiplier : 1);
      const fixed = [];
      if (mode === 'heavy') fixed.push({ label: 'Ataque Pesado', amount: rc.attacks.heavyFixedDamage });
      if (src.inst?.reforco && src.kind === 'weapon') {
        const lvl = R().discernment.reinforcement.find(x => x.level === src.inst.reforco);
        if (lvl) fixed.push({ label: `Reforço ${src.inst.reforco}`, amount: lvl.bonus });
      }
      const coatings = [];
      if (src.kind === 'weapon' && src.inst.coating) coatings.push({ dice: src.inst.coating.dice, type: src.inst.coating.type, label: src.inst.coating.name || 'Revestimento' });
      const selfCoats = (d.selfCoatings || []);
      for (const c of selfCoats) if (src.kind !== 'mutation') coatings.push({ dice: c.dice, type: c.type, label: c.name });
      let ignoreAllDr = false;
      if (d.combatFlags?.ignoreDrVs === tgt.id) { ignoreAllDr = true; d.combatFlags = { ...d.combatFlags, ignoreDrVs: null }; r.notes.push('Leitura da Presa: ignora Redução de Dano.'); }
      let totalDamage = 0;
      const dmgLines = [];
      for (let s = 0; s < shots; s++) {
        const dmg = M.computeDamage({
          base: src.damage, multiplier, excess: mode === 'visceral' ? 0 : ev.excess, fixed,
          trick: src.trick || [], trickBonus: (src.trick || []).length ? (mods.trickDamageBonus || 0) : 0,
          coatings: s === 0 ? coatings : [], target: tgt, massive: mode === 'visceral', ignoreDr: src.ref?.ignoreDr || 0, ignoreAllDr
        });
        totalDamage += dmg.total;
        if (shots > 1) dmgLines.push(`<i>Disparo ${s + 1}</i>`);
        dmgLines.push(...dmg.lines);
      }
      r.damage = { total: totalDamage, lines: dmgLines };
      if (ev.critical && mode !== 'visceral') r.notes.push('Sucesso Crítico: dano da arma dobrado.');
      if (mode === 'visceral') r.notes.push('Ataque Visceral: sempre acerta, dano da arma dobrado, Massivo.');

      if (autoApply()) applyHitTo(tgt, totalDamage, r, { hunterTarget: tgt.type === 'hunter', heavy: mode === 'heavy', attackerIsCreature: false });

      // Efeitos da forma e revestimentos
      const stCtx = stateCtx(cs);
      const eff = src.form?.effects || {};
      const applyS = (id, rounds) => {
        const res = M.addState(tgt.type, tgt.data, id, { rounds, ...stCtx });
        r.notes.push(res.ok ? `${model.stateDef(id)?.name || id} aplicado.` : `${model.stateDef(id)?.name || id}: ${res.reason}.`);
      };
      if (eff.onHitState) applyS(eff.onHitState);
      if (eff.onExcessState && ev.excess >= eff.onExcessState.min) applyS(eff.onExcessState.state, eff.onExcessState.rounds);
      if (eff.firstHitAfterSwitchState && src.inst.charged) { applyS(eff.firstHitAfterSwitchState); src.inst.charged = false; }
      if (eff.splashTrick && src.trick?.length) {
        const splash = M.rollParts(src.trick).map(x => `${x.amount} ${x.type}`).join(' + ');
        r.notes.push(`Brasas: uma segunda criatura a até 1,5 m sofre ${splash} (aplique no cartão de dano).`);
      }
      if (src.kind === 'weapon' && src.inst.coating?.state && ev.excess >= (src.inst.coating.minExcess || 0)) applyS(src.inst.coating.state);
      for (const s of src.applyStates || []) if (ev.excess >= (s.minExcess || 0)) applyS(s.state, s.rounds);
      if (mode === 'heavy' && ev.excess >= rc.attacks.heavyDestabilizePerExcess) {
        const n = Math.min(rc.attacks.heavyDestabilizeMax, Math.floor(ev.excess / rc.attacks.heavyDestabilizePerExcess));
        M.destabilize(tgt.type, tgt.data, n);
        r.notes.push(`Desestabilizar: alvo perde ${n} PA.`);
      }
      if (mode === 'visceral' && M.removeState(tgt.data, 'fractura')) r.notes.push('A criatura sai da Fractura.');
      if (mode === 'abate') applyS('fractura');
      save(tgt);
      results.push(r);
    }

    // ---- Registro do turno ----
    d.turn = { ...(d.turn || {}), attacks: (d.turn?.attacks || 0) + 1, unarmed: (d.turn?.unarmed || 0) + (src.kind === 'unarmed' ? 1 : 0) };
    if (src.kind === 'weapon' && src.inst.form === 'truque') d.combatFlags = { ...(d.combatFlags || {}), attackedInTrick: true };
    if (src.kind === 'weapon') {
      const w = d.weapons.find(x => x.uid === src.inst.uid);
      Object.assign(w, { form: src.inst.form, charged: src.inst.charged, ammo: src.inst.ammo });
    }
    if (M.hasState(d, 'latens') && !mods.silentCast) { M.removeState(d, 'latens'); notes.push('Latens removido ao atacar.'); }
    actor.data = d;
    save(actor);

    const modeName = { basic: 'Ataque Básico', heavy: 'Ataque Pesado', visceral: 'Ataque Visceral', abate: 'Tiro de Abate' }[mode];
    return card(user, {
      card: 'attack', attacker: actor.name, attackerId: actor.id, title: `${modeName}${p.trigger ? ' + Gatilho da Oficina' : ''}`,
      weapon: src.name, cost: totalCost, inCombat: cs.inCombat,
      pool: pool ? poolView(pool, null, poolInfo.parts) : null,
      results, notes: [...notes, ...(ammoNote ? [ammoNote] : [])], applied: autoApply()
    });
  }

  // Troca a forma da arma; guarda a mão livre se a nova forma exige Duas Mãos.
  function transformWeapon(d, inst, notes) {
    const ref = model.weaponRef(inst);
    const w = d.weapons.find(x => x.uid === inst.uid);
    const newForm = inst.form === 'padrao' ? 'truque' : 'padrao';
    const form = ref.forms[newForm];
    if (!form) fail('Esta arma não tem outra forma.');
    inst.form = newForm; w.form = newForm;
    notes.push(`${ref.name} → <b>${form.name}</b>.`);
    if (form.hands === 2 && d.equip.off && !d.equip.offStowed && d.equip.main === inst.uid) {
      d.equip.offStowed = true;
      const off = model.findItem(d, d.equip.off);
      const offName = off ? (off.kind === 'revolver' ? model.revolverRef(off.inst)?.name : model.channelerRef(off.inst)?.name) : 'item';
      notes.push(`Duas Mãos: ${offName} guardado automaticamente (sacar: 1 PA).`);
    }
    if (form.effects?.firstHitAfterSwitchState) { inst.charged = true; w.charged = true; }
    let selfDamage = null;
    if (form.effects?.triggerSelfDamage) selfDamage = form.effects.triggerSelfDamage;
    return { form, selfDamage };
  }

  // Aplica dano de um acerto, com Guarda e velas para caçadores.
  function applyHitTo(tgt, amount, r, { hunterTarget, heavy, attackerIsCreature }) {
    const td = tgt.data;
    if (hunterTarget && td.dying) {
      const res = candleChange(td, { out: 1 });
      r.notes.push(`Caçador Morrendo atingido: uma vela se apaga (${td.dying?.out ?? 3}/3).`);
      if (res.dead) r.notes.push('☠ Três velas apagadas: o caçador morre.');
      r.dealt = 0;
      return;
    }
    const res = M.dealDamage(tgt.type, td, amount);
    r.dealt = res.dealt;
    r.hpAfter = res.hpAfter;
    if (res.absorbed) r.notes.push(`Firmamentum absorveu ${res.absorbed}.`);
    if (res.fell) r.notes.push('🕯 <b>Vida 0: Morrendo.</b> Role as velas no início de cada turno.');
    if (res.defeated) r.notes.push(`💀 <b>${esc(tgt.name)} foi abatida.</b>${td.ecos ? ` Ecos: ${esc(td.ecos)}.` : ''}`);
    if (hunterTarget && attackerIsCreature) {
      const g = M.loseGuard(td, heavy ? R().combat.guard.lossOnHeavyHit : R().combat.guard.lossOnHit, {});
      if (g.lost) r.notes.push(`Guarda -${g.lost} (${g.after}).`);
      if (g.fractured) r.notes.push('✖ <b>Guarda 0: Fractura!</b> Perde o próximo turno.');
    }
    const retrib = (td.states || []).some(s => s.id === 'retributio');
    if (retrib && res.dealt > 0) r.notes.push(`Retributio: o atacante sofre ${Math.floor(res.dealt / 2)} (aplique no cartão).`);
  }

  // ================================================================
  // Ataque de CRIATURA (com oferta de Contra-Tiro ao alvo)
  // ================================================================
  async function creatureAttack(user, p) {
    if (user.role !== 'gm') fail('Apenas o Mestre controla criaturas.');
    const actor = getActor(p.actorId);
    if (actor.type !== 'creature') fail('Esta ficha não é uma criatura.');
    const d = clone(actor.data);
    const atk = (d.attacks || [])[Number(p.attackIndex) || 0];
    if (!atk) fail('Ataque não encontrado.');
    const cs = combatStatus(actor);
    const rc = R().combat;
    const heavy = !!p.heavy;
    const opportunity = !!p.opportunity;
    const targets = tokensOf(p.targets);
    if (!targets.length) fail('Selecione o alvo (tecla T sobre o token ou clique no alvo no diálogo).');
    const notes = [];

    if (!opportunity) {
      const maxA = d.maxAttacksPerTurn;
      if (cs.inCombat && maxA && (d.turn?.attacks || 0) >= maxA) fail(`Limite de ${maxA} ataques por turno.`);
      const cost = heavy ? rc.creatureActions.heavy : (atk.pa ?? rc.creatureActions.basic);
      payPa(d, cost, cs, 'o ataque');
      d.turn = { ...(d.turn || {}), attacks: (d.turn?.attacks || 0) + 1 };
      notes.push(`Custo: ${cost} PA${cs.inCombat ? ` (restam ${d.pa.value})` : ''}.`);
    } else notes.push('Ataque de oportunidade (sem custo).');
    actor.data = d;
    save(actor);

    const area = !!atk.area || targets.length > 1;
    let sharedPool = null, sharedInfo = null;
    if (area) {
      const dd = clone(getActor(actor.id).data);
      sharedInfo = M.creaturePool(dd, { bonus: Number(p.bonusDice) || 0 });
      sharedPool = M.roll(sharedInfo.count);
      actor.data = dd; save(actor);
    }

    const results = [];
    for (const t of targets) {
      const tgt = t.actor;
      const r = { targetId: t.token.id, targetActorId: tgt.id, targetName: t.token.data.name || tgt.name, notes: [] };

      // Contra-Tiro: oferecido ao alvo antes da rolagem (não em ataques em área).
      if (!area && tgt.type === 'hunter') {
        const counter = await maybeCounterShot(actor, tgt, atk.name);
        if (counter) {
          r.countered = true;
          r.counter = counter;
          if (counter.hit) { results.push(r); continue; }
        }
      }

      const fresh = getActor(tgt.id);
      fresh.data = clone(fresh.data);
      const lim = M.limiarOf(fresh, { cover: Number(p.cover) || 0 });
      let pool = sharedPool, info = sharedInfo;
      if (!pool) {
        const dd = clone(getActor(actor.id).data);
        info = M.creaturePool(dd, { bonus: Number(p.bonusDice) || 0 });
        pool = M.roll(info.count);
        const a2 = getActor(actor.id); a2.data = dd; save(a2);
      }
      const ev = M.judge(pool, lim.value);
      Object.assign(r, { limiar: lim.value, limiarParts: lim.parts, passed: ev.passed, excess: ev.excess, critical: ev.critical, pool: area ? null : poolView(pool, null, info.parts) });
      const fd = fresh.data;
      if (ev.passed) {
        const dmg = M.computeDamage({
          base: atk.damage, multiplier: ev.critical ? R().core.criticalDamageMultiplier : 1, excess: ev.excess,
          fixed: heavy ? [{ label: 'Ataque Pesado', amount: rc.attacks.heavyFixedDamage }] : [],
          trick: atk.trick || [], target: fresh
        });
        r.damage = { total: dmg.total, lines: dmg.lines };
        if (autoApply()) applyHitTo(fresh, dmg.total, r, { hunterTarget: fresh.type === 'hunter', heavy, attackerIsCreature: true });
        if (heavy && ev.excess >= rc.attacks.heavyDestabilizePerExcess) {
          const n = Math.min(rc.attacks.heavyDestabilizeMax, Math.floor(ev.excess / rc.attacks.heavyDestabilizePerExcess));
          M.destabilize(fresh.type, fd, n);
          r.notes.push(`Desestabilizar: perde ${n} PA.`);
        }
        // Estados de criaturas em caçadores: o caçador rola para resistir.
        r.pendingStates = (atk.applyStates || []).filter(s => ev.excess >= (s.minExcess || 0)).map(s => {
          const def = model.stateDef(s.state);
          return { state: s.state, name: def?.name || s.state, rounds: s.rounds ?? null, category: def?.category || 'fisico', resolved: fresh.type === 'hunter' ? null : 'applied' };
        });
        if (fresh.type !== 'hunter') for (const s of r.pendingStates) M.addState(fresh.type, fd, s.state, { rounds: s.rounds, ...stateCtx(cs) });
      } else if (fresh.type === 'hunter') {
        const def = fd.defense ? rc.defenses.find(x => x.id === fd.defense.id) : null;
        if (def && def.consumesGuard) {
          const g = M.loseGuard(fd, rc.guard.lossOnBlockedMiss, stateCtx(cs));
          r.notes.push(`${def.name} segurou o golpe: Guarda -${g.lost} (${g.after}).`);
          if (g.fractured) r.notes.push('✖ <b>Guarda 0: Fractura!</b>');
        } else if (def && def.id === 'esquiva') {
          r.notes.push('Esquivou: a Guarda não cai.');
          if (model.classDef(fd).id === 'noctivus') {
            fd.combatFlags = { ...(fd.combatFlags || {}), advantageVs: { ...(fd.combatFlags?.advantageVs || {}), [actor.id]: true } };
            r.notes.push('Passo da Névoa: Vantagem no próximo ataque contra esta criatura.');
          }
        }
      }
      save(fresh);
      results.push(r);
    }

    return card(user, {
      card: 'attack', creature: true, attacker: actor.name, attackerId: actor.id,
      title: `${atk.name}${heavy ? ' (Pesado)' : ''}`, weapon: atk.name,
      pool: area && sharedPool ? poolView(sharedPool, null, sharedInfo.parts) : null,
      results, notes, applied: autoApply()
    });
  }

  // Oferece Contra-Tiro ao alvo e resolve se aceito. Retorna null se não houve.
  async function maybeCounterShot(attacker, target, attackName) {
    const td = target.data;
    const cs = combatStatus(target);
    if (!cs.inCombat) return null;
    if (td.dying || M.hasState(td, 'fractura') || M.hasState(td, 'inermis')) return null;
    const h = model.hands(td);
    if (!h.revolverInHand) return null;
    const mods = model.modifiers(td, 'hunter');
    const cost = mods.counterShotCost ?? R().combat.counterShot.cost;
    if ((td.pa?.value || 0) < cost) return null;
    const gun = h.offReady && h.off?.kind === 'revolver' ? { kind: 'revolver', inst: h.off.inst } : { kind: 'weapon', inst: h.main };
    if ((gun.inst.ammo ?? 0) < 1) return null;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeout = (R().combat.counterShot.reactionTimeoutSeconds || 45) * 1000;
    const answer = await new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve(false); }, timeout);
      pending.set(id, { targetActorId: target.id, ownerId: target.owner_id, resolve: (v) => { clearTimeout(timer); pending.delete(id); resolve(v); } });
      const payload = { id, attacker: attacker.name, attack: attackName, target: target.name, targetActorId: target.id, cost, timeout: timeout / 1000 };
      if (target.owner_id && rt.isOnline(target.owner_id)) rt.emitUser(target.owner_id, 'sys:reaction', payload);
      rt.emitGM('sys:reaction', { ...payload, forGM: true, ownerOnline: !!(target.owner_id && rt.isOnline(target.owner_id)) });
    });
    rt.emitAll('sys:reactionClosed', { id });
    if (!answer) return null;
    return resolveCounterShot(attacker, target.id, cost);
  }

  function resolveCounterShot(attacker, targetId, cost) {
    const target = getActor(targetId);
    const td = clone(target.data);
    const cs = combatStatus(target);
    const rc = R().combat;
    td.pa = { value: Math.max(0, (td.pa?.value || 0) - cost) };
    const h = model.hands(td);
    const gunInst = h.offReady && h.off?.kind === 'revolver' ? td.revolvers.find(r => r.uid === h.off.inst.uid) : td.weapons.find(w => w.uid === h.main?.uid);
    const gunRef = h.offReady && h.off?.kind === 'revolver' ? model.revolverRef(gunInst) : model.weaponRef(gunInst)?.forms.padrao;
    if (gunInst) gunInst.ammo = Math.max(0, (gunInst.ammo || 0) - rc.counterShot.ammo);
    const info = M.hunterPool(td, rc.counterShot.attribute, rc.counterShot.skill);
    const pool = M.roll(info.count);
    const att = getActor(attacker.id);
    att.data = clone(att.data);
    const lim = M.limiarOf(att, { consume: false });
    const ev = M.judge(pool, lim.value);
    const notes = [];
    if (ev.passed) {
      M.addState('creature', att.data, rc.counterShot.appliesState, { rounds: 1, ...stateCtx(cs) });
      notes.push(`✖ <b>${esc(att.name)} entra em Fractura!</b> O golpe é interrompido. Qualquer aliado pode fazer um Ataque Visceral.`);
      const mods = model.modifiers(td, 'hunter');
      if (model.classDef(td).id === 'venaturnus') {
        td.combatFlags = { ...(td.combatFlags || {}), ignoreDrVs: att.id };
        notes.push('Leitura da Presa: o próximo ataque contra ela ignora Redução de Dano.');
      }
      if (mods.counterShotRefund) { td.pa.value += mods.counterShotRefund; notes.push(`Eco do Disparo: +${mods.counterShotRefund} PA.`); }
      if (mods.counterShotDamageAtExcess && ev.excess >= mods.counterShotDamageAtExcess && gunRef) {
        const dmg = M.computeDamage({ base: gunRef.damage, excess: ev.excess, target: att });
        const res = M.dealDamage('creature', att.data, dmg.total);
        notes.push(`Mão Firme: ${res.dealt} de dano.`);
      }
    } else {
      notes.push('O disparo erra: o golpe acontece normalmente.');
    }
    target.data = td; save(target);
    save(att);
    card(null, {
      card: 'attack', title: 'Contra-Tiro', attacker: target.name, attackerId: target.id, weapon: gunRef?.name || 'Revólver', cost,
      pool: poolView(pool, ev, info.parts), results: [{ targetName: att.name, limiar: lim.value, limiarParts: lim.parts, passed: ev.passed, excess: ev.excess, notes }], notes: []
    });
    return { hit: ev.passed, successes: pool.successes };
  }

  // ================================================================
  // Arcanos e Marcas
  // ================================================================
  async function castArcane(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    if (actor.type !== 'hunter') fail('Apenas caçadores conjuram por aqui.');
    const ar = IDX().arcana[p.arcaneId];
    if (!ar) fail('Arcano não encontrado.');
    const cs = combatStatus(actor);
    ensureCanAct(user, actor, cs);
    const d = clone(actor.data);
    const gm = user.role === 'gm';
    const notes = [];
    if (!gm && !(d.arcana.known || []).includes(ar.id)) fail('Você não conhece este Arcano.');
    if (!gm && !(d.arcana.prepared || []).includes(ar.id)) fail('Este Arcano não está preparado.');
    if (ar.outOfCombat && cs.inCombat) fail('Este Arcano só pode ser usado fora de combate.');
    if (M.hasState(d, 'silentium')) fail('Silentium: você não pode conjurar.');

    // Canalizador em mãos (ou Reserva Arcana do Arcanivagus).
    const h = model.hands(d);
    let extraPa = 0;
    if (!h.channelerInHand) {
      const cls = model.classDef(d);
      const maxRes = (cls.passive?.usesPerCombat || 0) + ((d.talents || []).includes('andar-entre-mundos') ? 1 : 0);
      if (cls.id === 'arcanivagus' && p.useReserve && (d.combatFlags?.reserve || 0) < maxRes) {
        extraPa = (d.talents || []).includes('andar-entre-mundos') ? 1 : (cls.passive.extraPa || 2);
        d.combatFlags = { ...(d.combatFlags || {}), reserve: (d.combatFlags?.reserve || 0) + 1 };
        notes.push(`Reserva Arcana: conjura pelo próprio sangue (+${extraPa} PA).`);
      } else fail('É preciso um Canalizador em mãos para conjurar.');
    }

    // Regra Magicka (recarga)
    const cd = R() && system.compendium.arcana.meta.defaultCooldown;
    if (cs.inCombat && !ar.noCooldown) {
      const avail = d.arcana.cooldowns?.[ar.id];
      if (avail && cs.round < avail) fail(`Em recarga até a rodada ${avail}.`);
    }

    // Custos (com descontos do Canalizador)
    const chan = h.channelerInHand ? model.channelerRef(h.off.inst) : null;
    const eff = chan?.effects || {};
    let pa = ar.pa + extraPa;
    if (eff.paDiscount && eff.paDiscount.arcane === ar.id) pa = Math.max(0, pa - eff.paDiscount.amount);
    const costs = ar.costs || {};
    let flasks = costs.flasks || 0;
    if (eff.flaskDiscount && eff.flaskDiscount.academy === ar.academy) flasks = Math.max(0, flasks - eff.flaskDiscount.amount);
    let hpCost = costs.hp || 0;
    if (eff.hpDiscount && eff.hpDiscount.academy === ar.academy) hpCost = Math.max(0, hpCost - eff.hpDiscount.amount);
    if ((d.flasks || 0) < flasks) fail(`Precisa de ${flasks} Frasco(s) de Sangue.`);
    payPa(d, pa, cs, 'o Arcano');
    if (flasks) { d.flasks -= flasks; notes.push(`-${flasks} Frasco(s) de Sangue.`); }
    if (hpCost) { const r = M.dealDamage('hunter', d, hpCost); notes.push(`-${r.dealt} de Vida própria.`); }
    if (costs.selfDamage) { const [sd] = M.rollParts([costs.selfDamage]); const r = M.dealDamage('hunter', d, sd.amount); notes.push(`Sofre ${r.dealt} ${sd.type}.`); }
    if (costs.dementia) {
      const before = d.dementia || 0;
      d.dementia = Math.min(R().dementia.max, before + costs.dementia);
      notes.push(`+${costs.dementia} Dementia (${d.dementia}).`, ...stageNotes(d, before, d.dementia));
    }
    if (cs.inCombat && !ar.noCooldown) d.arcana.cooldowns = { ...(d.arcana.cooldowns || {}), [ar.id]: cs.round + (ar.cooldown || cd || 3) };

    const academy = R().classes.academies.find(a => a.id === ar.academy);
    const result = resolveEffect(user, actor, d, ar, { rollDef: academy.roll, targets: tokensOf(p.targets), cs, notes, bonus: Number(p.bonusDice) || 0, afinacao: h.channelerInHand ? (h.off.inst.afinacao || 0) : 0, arcane: true });
    if (M.hasState(d, 'latens') && !(d.talents || []).includes('conjuracao-silenciosa')) { M.removeState(d, 'latens'); notes.push('Latens removido.'); }
    actor.data = d; save(actor);
    return card(user, { card: 'attack', kind: 'arcane', title: ar.name, attacker: actor.name, attackerId: actor.id, weapon: academy.name, cost: pa, text: ar.text, ...result, notes, applied: autoApply() });
  }

  async function useMark(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const mk = IDX().marks[p.markId];
    if (!mk) fail('Marca não encontrada.');
    const cs = combatStatus(actor);
    ensureCanAct(user, actor, cs, { reaction: !!mk.reaction });
    const d = clone(actor.data);
    const notes = [];
    if (user.role !== 'gm' && !(d.marks || []).includes(mk.id)) fail('Você não aprendeu esta Marca.');
    const inv = (d.inventory || []).find(i => i.ref === mk.material && i.qty > 0);
    if (!inv) fail(`Sem material: ${IDX().items[mk.material]?.name || mk.material}.`);
    payPa(d, mk.pa || 0, cs, 'a Marca');
    const mods = model.modifiers(d, 'hunter');
    let saved = false;
    if (mods.materialSaveOn6) {
      const r = M.rollFormula('1d6');
      if (r.total === 6) { saved = true; notes.push('Bolsos Fundos: tirou 6, o material não foi consumido.'); }
    }
    if (!saved) { inv.qty -= 1; notes.push(`Material consumido (restam ${inv.qty}).`); }
    const result = resolveEffect(user, actor, d, mk, { rollDef: mk.roll, targets: tokensOf(p.targets), cs, notes, bonus: Number(p.bonusDice) || 0 });
    actor.data = d; save(actor);
    return card(user, { card: 'attack', kind: 'mark', title: mk.name, attacker: actor.name, attackerId: actor.id, weapon: 'Marca do Caçador', cost: mk.pa, text: mk.text, ...result, notes, applied: autoApply() });
  }

  // Efeito genérico de Arcano/Marca descrito no JSON.
  function resolveEffect(user, actor, d, def, { rollDef, targets, cs, notes, bonus, afinacao = 0, arcane = false }) {
    const stCtx = stateCtx(cs);
    const results = [];
    const mods = model.modifiers(d, 'hunter');
    let pool = null, info = null;
    const needsRoll = rollDef && (def.attack || def.healPerSuccess || def.removeStateOnSuccess);
    if (needsRoll) {
      const extra = [];
      const cls = model.classDef(d);
      const h = model.hands(d);
      if (arcane && cls.id === 'sanctifer' && (def.heal || def.protection) && h.channelerInHand && h.main?.form === 'padrao') extra.push({ dice: 1, label: 'Vínculo do Selo +1' });
      if (def.advantageIfTargetState && targets[0] && M.hasState(targets[0].actor.data, def.advantageIfTargetState)) extra.push({ dice: 1, label: 'Vantagem +1' });
      info = M.hunterPool(d, rollDef[0], rollDef[1], { bonus, extraParts: extra });
      pool = M.roll(info.count);
    }

    // Ataques contra o Limiar de cada alvo
    if (def.attack) {
      if (!targets.length) notes.push('Nenhum alvo selecionado: apenas a rolagem foi feita.');
      for (const t of targets) {
        const tgt = t.actor; tgt.data = clone(tgt.data);
        if (def.notAgainstTiers && tgt.type === 'creature' && def.notAgainstTiers.includes(tgt.data.tier)) {
          results.push({ targetName: t.token.data.name || tgt.name, passed: false, notes: ['Não funciona contra este tipo de criatura.'] });
          continue;
        }
        const lim = M.limiarOf(tgt, {});
        const ev = M.judge(pool, lim.value);
        const r = { targetId: t.token.id, targetActorId: tgt.id, targetName: t.token.data.name || tgt.name, limiar: lim.value, limiarParts: lim.parts, passed: ev.passed, excess: ev.excess, critical: ev.critical, notes: [] };
        if (ev.passed) {
          if (def.damage) {
            const fixed = afinacao ? [{ label: `Afinação ${afinacao}`, amount: R().discernment.reinforcement.find(x => x.level === afinacao)?.bonus || 0 }] : [];
            const dmg = M.computeDamage({ base: def.damage, multiplier: ev.critical ? R().core.criticalDamageMultiplier : 1, excess: ev.excess, fixed, target: tgt, massive: !!def.massive });
            r.damage = { total: dmg.total, lines: dmg.lines };
            if (autoApply()) applyHitTo(tgt, dmg.total, r, { hunterTarget: tgt.type === 'hunter', heavy: false, attackerIsCreature: false });
          }
          for (const s of def.applyStates || []) {
            if (ev.excess < (s.minExcess || 0)) continue;
            const res = M.addState(tgt.type, tgt.data, s.state, { rounds: s.rounds, ...stCtx });
            r.notes.push(res.ok ? `${model.stateDef(s.state)?.name} aplicado.` : `${model.stateDef(s.state)?.name}: ${res.reason}.`);
          }
        }
        save(tgt);
        results.push(r);
      }
    }

    // Acerto automático (Stellae Sequaces, Corda de Prata)
    if (def.autoHit) {
      const hits = def.hits || 1;
      if (!targets.length) notes.push('Selecione alvo(s).');
      for (let i = 0; i < hits && targets.length; i++) {
        const t = targets[i % targets.length];
        const tgt = getActor(t.actor.id); tgt.data = clone(tgt.data);
        const r = { targetId: t.token.id, targetActorId: tgt.id, targetName: t.token.data.name || tgt.name, passed: true, auto: true, notes: [] };
        if (def.damage) {
          const dmg = M.computeDamage({ base: def.damage, target: tgt, massive: !!def.massive });
          r.damage = { total: dmg.total, lines: dmg.lines };
          if (autoApply()) applyHitTo(tgt, dmg.total, r, { hunterTarget: tgt.type === 'hunter' });
        }
        for (const s of def.applyStates || []) {
          const res = M.addState(tgt.type, tgt.data, s.state, { rounds: s.rounds, ...stCtx });
          r.notes.push(res.ok ? `${model.stateDef(s.state)?.name} aplicado.` : res.reason);
        }
        save(tgt);
        results.push(r);
      }
    }

    // Efeitos em aliados tocados / si mesmo
    const allyTargets = targets.length ? targets : [{ token: tokenOfActor(actor) || { data: { name: actor.name } }, actor }];
    if (def.heal || def.grantPa || def.targetStates || def.removeNegativeState || def.healPerSuccess || def.coating) {
      for (const t of allyTargets) {
        const self = t.actor.id === actor.id;
        const tgt = self ? { ...actor, data: d } : getActor(t.actor.id);
        if (!self) tgt.data = clone(tgt.data);
        const r = { targetName: (t.token?.data?.name) || tgt.name, passed: true, support: true, notes: [] };
        const tMods = tgt.type === 'hunter' ? model.modifiers(tgt.data, 'hunter') : {};
        const maxHp = tgt.type === 'hunter' ? model.derivedHunter(tgt.data).hpMax : tgt.data.hp?.max;
        if (def.heal) {
          if (arcane && tMods.noArcaneHealing) r.notes.push('Coração de Aço: não recebe cura de Arcanos.');
          else {
            const [h] = M.rollParts([{ dice: def.heal, type: 'cura' }]);
            let bonusHeal = 0;
            const res = M.healDamage(tgt.type, tgt.data, h.amount + bonusHeal, maxHp);
            r.notes.push(`Cura ${h.amount}${res.revived ? ' — sai de Morrendo' : ''} (Vida ${res.after}).`);
            if (arcane && model.classDef(d).id === 'sanctifer' && tgt.type === 'hunter') {
              const gmax = model.derivedHunter(tgt.data).guardMax;
              tgt.data.guard = { value: Math.min(gmax, (tgt.data.guard?.value || 0) + 1) };
              r.notes.push('Vínculo do Selo: +1 Guarda.');
            }
          }
        }
        if (def.healPerSuccess && pool) {
          if (pool.successes >= 1 && def.removeStateOnSuccess && M.removeState(tgt.data, def.removeStateOnSuccess)) r.notes.push(`${model.stateDef(def.removeStateOnSuccess)?.name} removido.`);
          const res = M.healDamage(tgt.type, tgt.data, pool.successes * def.healPerSuccess, maxHp);
          r.notes.push(`Cura ${res.healed} (Vida ${res.after}).`);
        }
        if (def.grantPa) {
          if (self) r.notes.push('Não pode ser usado em si mesmo.');
          else {
            const pmax = tgt.type === 'hunter' ? model.derivedHunter(tgt.data).paMax : R().combat.pa.max;
            tgt.data.pa = { value: Math.min(pmax, (tgt.data.pa?.value || 0) + def.grantPa) };
            r.notes.push(`+${def.grantPa} PA (${tgt.data.pa.value}).`);
          }
        }
        for (const s of def.targetStates || []) {
          const res = M.addState(tgt.type, tgt.data, s.state, { rounds: s.rounds, value: s.value, ...stCtx });
          r.notes.push(res.ok ? `${model.stateDef(s.state)?.name} aplicado.` : res.reason);
        }
        if (def.removeNegativeState) {
          const neg = (tgt.data.states || []).find(s => ['negativo', 'continuo'].includes(model.stateDef(s.id)?.group));
          if (neg) { M.removeState(tgt.data, neg.id); r.notes.push(`${model.stateDef(neg.id)?.name} removido.`); } else r.notes.push('Nenhum Estado Negativo.');
        }
        if (def.coating && !def.coating.self) {
          const wInst = (tgt.data.weapons || []).find(w => w.uid === tgt.data.equip?.main);
          if (!wInst) r.notes.push('Sem arma empunhada para revestir.');
          else {
            const rounds = model.modifiers(d, 'hunter').coatingRounds || def.coating.rounds || 3;
            wInst.coating = { name: def.name, dice: def.coating.dice, type: def.coating.type, rounds, state: def.coating.state || null, minExcess: def.coating.minExcess || 0 };
            r.notes.push(`Arma revestida: +${def.coating.dice} ${def.coating.type} por ${rounds} turnos.`);
          }
        }
        if (!self) save(tgt);
        results.push(r);
        if (def.coating || def.removeNegativeState || def.grantPa) break; // alvo único
      }
    }
    // Revestimento do próprio corpo (Mutatio Accelerata)
    if (def.coating && def.coating.self) {
      d.selfCoatings = [...(d.selfCoatings || []).filter(c => c.name !== def.name), { name: def.name, dice: def.coating.dice, type: def.coating.type, rounds: def.coating.rounds || 3 }];
      notes.push(`Ataques com arma: +${def.coating.dice} ${def.coating.type} por ${def.coating.rounds || 3} turnos.`);
    }
    for (const s of def.selfStates || []) {
      let value = s.value;
      if (s.valueDice) value = M.rollFormula(s.valueDice).total;
      const res = M.addState('hunter', d, s.state, { rounds: s.rounds, value, expireAtStart: s.rounds === 1, ...stCtx });
      notes.push(res.ok ? `${model.stateDef(s.state)?.name}${value ? ` (${value})` : ''} em si mesmo.` : res.reason);
    }
    if (!def.attack && !def.autoHit && pool) notes.push(`${pool.successes} sucesso(s).`);
    return { pool: pool ? poolView(pool, null, info.parts) : null, results };
  }

  // ================================================================
  // Ações diversas
  // ================================================================
  function defend(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const cs = combatStatus(actor);
    ensureCanAct(user, actor, cs);
    const d = clone(actor.data);
    if ((d.states || []).some(s => model.stateDef(s.id)?.modifiers?.noDefense)) fail('Você não pode usar ações defensivas agora.');
    const def = R().combat.defenses.find(x => x.id === p.defense);
    if (!def) fail('Ação defensiva inválida.');
    if (def.requiresMelee && !model.hands(d).mainReady) fail('Aparar exige uma arma corpo a corpo em mãos.');
    const mods = model.modifiers(d, 'hunter');
    const bonus = mods.defenseBonus?.[def.id] ?? def.bonus;
    payPa(d, def.pa, cs, def.name);
    d.defense = { id: def.id, name: def.name, bonus };
    actor.data = d; save(actor);
    const lim = model.derivedHunter(d).limiar;
    card(user, { card: 'info', title: def.name, actor: actor.name, text: `+${bonus} ao Limiar até o início do próximo turno. Limiar atual: <b>${lim}</b>.${def.noAttack ? ' Não pode atacar.' : ''}`, cost: def.pa });
  }

  function genericAction(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const a = R().combat.actions.find(x => x.id === p.id);
    if (!a) fail('Ação inválida.');
    const cs = combatStatus(actor);
    ensureCanAct(user, actor, cs, { reaction: a.group === 'Reação' });
    const d = clone(actor.data);
    if (a.id === 'levantar' || a.removesState === 'prostratus') { if (d.dying) fail('Morrendo: não consegue se levantar.'); }
    if (['caminhada', 'corrida', 'disparada'].includes(a.id) && M.hasState(d, 'immotus')) fail('Immotus: não pode se deslocar.');
    payPa(d, a.pa, cs, a.name);
    const notes = [];
    if (a.removesState && M.removeState(d, a.removesState)) notes.push(`${model.stateDef(a.removesState)?.name} removido.`);
    if (a.appliesState) { M.addState(actor.type, d, a.appliesState, { ...stateCtx(cs) }); notes.push(`${model.stateDef(a.appliesState)?.name} aplicado.`); }
    let pool = null, info = null, ev = null;
    if (a.roll && actor.type === 'hunter') {
      info = M.hunterPool(d, a.roll[0], a.roll[1], { bonus: Number(p.bonusDice) || 0 });
      pool = M.roll(info.count);
      ev = a.difficulty ? M.judge(pool, a.difficulty) : null;
    }
    actor.data = d; save(actor);
    card(user, { card: pool ? 'test' : 'info', title: a.name, actor: actor.name, actorId: actor.id, cost: cs.inCombat ? a.pa : 0, text: notes.join(' '), pool: pool ? poolView(pool, ev, info.parts) : undefined, notes });
  }

  // Sacar/guardar/trocar/recarregar e transformar fora de combate.
  function handsAction(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    if (actor.type !== 'hunter') fail('Apenas caçadores.');
    const cs = combatStatus(actor);
    ensureCanAct(user, actor, cs);
    const d = clone(actor.data);
    const rc = R().combat;
    const notes = [];
    const cost = (id) => rc.actions.find(x => x.id === id)?.pa ?? 1;
    switch (p.op) {
      case 'transform': {
        if (cs.inCombat && user.role !== 'gm') fail('Em combate, a troca de forma acontece junto de um Ataque Básico (marque "Gatilho" no ataque).');
        const w = d.weapons.find(x => x.uid === (p.uid || d.equip.main));
        if (!w) fail('Arma não encontrada.');
        const tr = transformWeapon(d, w, notes);
        if (tr.selfDamage) { const r = M.dealDamage('hunter', d, tr.selfDamage.amount); notes.push(`-${r.dealt} Vida.`); }
        break;
      }
      case 'drawOff': {
        if (!d.equip.off) fail('Nada na mão livre.');
        const h = model.hands(d);
        if (h.twoHanded) fail('A arma está numa forma de Duas Mãos. Volte à forma de Uma Mão primeiro.');
        if (!d.equip.offStowed) fail('Já está em mãos.');
        payPa(d, cost('sacar'), cs, 'sacar');
        d.equip.offStowed = false;
        notes.push('Item da mão livre sacado.');
        break;
      }
      case 'stowOff':
        payPa(d, cost('guardar'), cs, 'guardar');
        d.equip.offStowed = true;
        notes.push('Item da mão livre guardado.');
        break;
      case 'drawMain':
        if (!d.equip.mainStowed) fail('A arma já está em mãos.');
        payPa(d, cost('sacar'), cs, 'sacar');
        d.equip.mainStowed = false;
        notes.push('Arma sacada.');
        break;
      case 'setOff': {
        // Troca o item da mão livre (revólver ↔ Canalizador): Trocar de arma.
        const found = model.findItem(d, p.uid);
        if (!found || found.kind === 'weapon') fail('Escolha um revólver ou Canalizador.');
        payPa(d, cost('trocar-arma'), cs, 'trocar');
        d.equip.off = p.uid; d.equip.offStowed = false;
        if (model.hands(d).twoHanded) d.equip.offStowed = true;
        notes.push('Mão livre trocada.');
        break;
      }
      case 'setMain': {
        const found = model.findItem(d, p.uid);
        if (!found || found.kind !== 'weapon') fail('Escolha uma arma TOC.');
        payPa(d, cost('trocar-arma'), cs, 'trocar');
        d.equip.main = p.uid; d.equip.mainStowed = false;
        if (model.hands(d).twoHanded && d.equip.off) d.equip.offStowed = true;
        notes.push('Arma principal trocada.');
        break;
      }
      case 'reload': {
        const found = model.findItem(d, p.uid);
        if (!found) fail('Arma não encontrada.');
        let cap, ammoItem;
        if (found.kind === 'revolver') { const ref = model.revolverRef(found.inst); cap = ref.ammoCapacity; ammoItem = ref.ammoItem || 'municao-comum'; }
        else { const f = Object.values(model.weaponRef(found.inst).forms).find(x => x.ranged); if (!f) fail('Esta arma não dispara.'); cap = f.ammoCapacity; ammoItem = f.ammoItem || 'municao-comum'; }
        const need = cap - (found.inst.ammo || 0);
        if (need <= 0) fail('Já está carregada.');
        const inv = (d.inventory || []).find(i => i.ref === ammoItem && i.qty > 0) || (ammoItem === 'municao-comum' ? (d.inventory || []).find(i => i.ref === 'bala-de-prata' && i.qty > 0) : null);
        if (!inv) fail(`Sem munição (${IDX().items[ammoItem]?.name || ammoItem}).`);
        const mods = model.modifiers(d, 'hunter');
        payPa(d, (d.mutations || []).includes('garras-osseas') ? 2 : cost('recarregar'), cs, 'recarregar');
        const n = Math.min(need, inv.qty);
        inv.qty -= n; found.inst.ammo = (found.inst.ammo || 0) + n;
        // Recarregar exige uma mão livre: a outra é guardada.
        if (found.kind === 'revolver' && d.equip.main && !d.equip.mainStowed) { d.equip.mainStowed = true; notes.push('A arma principal foi guardada para recarregar (sacar: 1 PA).'); }
        if (found.kind === 'weapon' && d.equip.off && !d.equip.offStowed) { d.equip.offStowed = true; notes.push('A mão livre foi guardada para recarregar (sacar: 1 PA).'); }
        notes.push(`Recarregado: ${found.inst.ammo}/${cap}.`);
        break;
      }
      default: fail('Operação inválida.');
    }
    actor.data = d; save(actor);
    card(user, { card: 'info', title: { transform: 'Truque da Oficina', drawOff: 'Sacar', stowOff: 'Guardar', drawMain: 'Sacar arma', setOff: 'Trocar mão livre', setMain: 'Trocar arma', reload: 'Recarregar' }[p.op], actor: actor.name, text: notes.join(' ') });
  }

  function drinkFlask(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    if (actor.type !== 'hunter') fail('Apenas caçadores.');
    const cs = combatStatus(actor);
    const d = clone(actor.data);
    if ((d.flasks || 0) < 1) fail('Sem Frascos de Sangue.');
    const mods = model.modifiers(d, 'hunter');
    const target = p.targetActorId && Number(p.targetActorId) !== actor.id ? getActor(p.targetActorId) : null;
    if (!target) ensureCanAct(user, actor, cs);
    let cost = R().combat.flask.pa;
    if (mods.freeFlaskPerTurn && !d.turn?.freeFlask) { cost = 0; d.turn = { ...(d.turn || {}), freeFlask: true }; }
    payPa(d, cost, cs, 'beber o Frasco');
    d.flasks -= 1;
    const heal = (mods.flaskHeal ?? R().combat.flask.heal) + (mods.flaskHealBonus || 0);
    const tgt = target ? { ...target, data: clone(target.data) } : { ...actor, data: d };
    const res = M.healDamage('hunter', tgt.data, heal, model.derivedHunter(tgt.data).hpMax);
    if (target) save(tgt);
    actor.data = d; save(actor);
    card(user, { card: 'info', title: 'Frasco de Sangue', actor: actor.name, text: `${target ? `${esc(target.name)} recupera` : 'Recupera'} <b>${res.healed}</b> de Vida (${res.after}).${res.revived ? ' Sai de Morrendo.' : ''} Frascos restantes: ${d.flasks}.`, cost });
  }

  function useItem(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const cs = combatStatus(actor);
    ensureCanAct(user, actor, cs);
    const d = clone(actor.data);
    const inv = (d.inventory || []).find(i => i.uid === p.uid);
    if (!inv || inv.qty < 1) fail('Item indisponível.');
    const ref = inv.ref ? IDX().items[inv.ref] : null;
    const notes = [];
    payPa(d, 1, cs, 'usar o item');
    inv.qty -= 1;
    if (ref?.removesStates) {
      const removed = ref.removesStates.filter(s => M.removeState(d, s));
      notes.push(removed.length ? `Removido: ${removed.map(s => model.stateDef(s)?.name).join(', ')}.` : 'Nada a remover.');
    }
    if (inv.ref === 'adrenalina') {
      M.addState('hunter', d, 'adrenalina', { rounds: null });
      notes.push('Máximo de PA 11 até o fim do combate. Depois: Torpor até o próximo descanso.');
    }
    if (inv.ref === 'frasco-de-sangue') { d.flasks = (d.flasks || 0) + 1; notes.push('Frasco adicionado ao cinto.'); }
    if (!notes.length && ref?.text) notes.push(ref.text);
    actor.data = d; save(actor);
    card(user, { card: 'info', title: inv.name, actor: actor.name, text: notes.join(' '), cost: cs.inCombat ? 1 : 0 });
  }

  function prepareArcana(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const d = clone(actor.data);
    const cs = combatStatus(actor);
    if (cs.inCombat && user.role !== 'gm') fail('Trocar Arcanos preparados exige descanso ou a Oficina (fora de combate).');
    const list = [...new Set((p.prepared || []).filter(a => (d.arcana.known || []).includes(a)))];
    const slots = model.derivedHunter(d).spellSlots;
    if (list.length > slots && user.role !== 'gm') fail(`Você tem ${slots} Espaço(s) de Magia.`);
    d.arcana.prepared = list;
    actor.data = d; save(actor);
  }

  // Dano/cura manuais (botões dos cartões e do HUD do token).
  function adjust(user, p) {
    if (user.role !== 'gm') fail('Apenas o Mestre aplica dano e cura.');
    const ids = p.actorIds || (p.actorId ? [p.actorId] : []);
    const lines = [];
    for (const id of ids) {
      const actor = getActor(id);
      const d = clone(actor.data);
      const amount = Math.floor(Number(p.amount) || 0);
      if (p.mode === 'heal') {
        const max = actor.type === 'hunter' ? model.derivedHunter(d).hpMax : d.hp?.max;
        const r = M.healDamage(actor.type, d, amount, max);
        lines.push(`${esc(actor.name)}: +${r.healed} Vida (${r.after})${r.revived ? ', sai de Morrendo' : ''}.`);
      } else {
        let total = amount;
        if (p.type && !p.massive) {
          const dv = actor.type === 'hunter' ? model.derivedHunter(d) : model.derivedCreature(d);
          const weak = actor.type === 'hunter' ? dv.weaknesses : (d.weaknesses || []);
          const res = actor.type === 'hunter' ? [] : (d.resistances || []);
          if (weak.includes(p.type)) { const w = M.rollFormula(R()['damage-types'].weakness.extraDice).total; total += w; lines.push(`Fraqueza a ${p.type}: +${w}.`); }
          if (res.includes(p.type)) { total = Math.floor(total / 2); lines.push(`Resistência a ${p.type}: metade.`); }
          if (dv.dr) total = Math.max(0, total - dv.dr);
        }
        if (p.half) total = Math.floor(total / 2);
        if (actor.type === 'hunter' && d.dying) { candleChange(d, { out: 1 }); lines.push(`${esc(actor.name)} está Morrendo: uma vela se apaga.`); }
        else {
          const r = M.dealDamage(actor.type, d, total);
          lines.push(`${esc(actor.name)}: -${r.dealt} Vida (${r.hpAfter})${r.fell ? ' — <b>Morrendo</b>' : ''}${r.defeated ? ' — <b>abatida</b>' : ''}.`);
          if (p.guard && actor.type === 'hunter') { const g = M.loseGuard(d, 1, stateCtx(combatStatus(actor))); if (g.lost) lines.push(`Guarda -1 (${g.after}).`); }
        }
      }
      actor.data = d; save(actor);
    }
    if (p.silent) return;
    card(user, { card: 'info', title: p.mode === 'heal' ? 'Cura aplicada' : 'Dano aplicado', text: lines.join('<br>') });
  }

  function setState(user, p) {
    if (user.role !== 'gm') fail('Apenas o Mestre aplica e remove Estados.');
    const actor = getActor(p.actorId);
    const d = clone(actor.data);
    const cs = combatStatus(actor);
    let text;
    if (p.remove) {
      M.removeState(d, p.state);
      if (p.state === 'fractura' && actor.type === 'hunter') d.guard = { value: model.derivedHunter(d).guardMax };
      if (p.state === 'morrendo') d.dying = null;
      text = `${model.stateDef(p.state)?.name} removido de ${esc(actor.name)}.`;
    } else {
      const res = M.addState(actor.type, d, p.state, { rounds: p.rounds === '' || p.rounds == null ? undefined : Number(p.rounds), value: p.value != null && p.value !== '' ? Number(p.value) : undefined, ...stateCtx(cs) });
      if (!res.ok) fail(`${model.stateDef(p.state)?.name || p.state}: ${res.reason}.`);
      if (p.state === 'morrendo' && actor.type === 'hunter' && !d.dying) d.dying = { lit: 0, out: 0, parasiteUsed: false, stable: false };
      text = `${esc(actor.name)} recebe ${model.stateDef(p.state)?.name}.`;
    }
    actor.data = d; save(actor);
    if (!p.silent) world.systemMessage(text);
  }

  // Botão "Resistir" no cartão de ataque de criatura.
  function resistState(user, p) {
    const msg = store.chat.get(Number(p.msgId));
    if (!msg || msg.data.card !== 'attack') fail('Cartão não encontrado.');
    const r = msg.data.results?.[Number(p.index)];
    const st = r?.pendingStates?.[Number(p.stateIndex)];
    if (!st || st.resolved) fail('Já resolvido.');
    const actor = getActor(r.targetActorId);
    ensureControl(user, actor);
    const d = clone(actor.data);
    const cs = combatStatus(actor);
    let outcome;
    if (p.mode === 'apply') {
      if (user.role !== 'gm') fail('Apenas o Mestre aplica sem teste.');
      const res = M.addState(actor.type, d, st.state, { rounds: st.rounds, ...stateCtx(cs) });
      outcome = res.ok ? 'applied' : 'immune';
    } else {
      const mods = model.modifiers(d, 'hunter');
      if (mods.paTurnStart) fail('Coração de Vidro: você nunca rola para resistir a Estados.');
      const cat = r.pendingStates[p.stateIndex].category || 'fisico';
      const rollDef = R().states.resist[cat] || R().states.resist.fisico;
      const info = M.hunterPool(d, rollDef[0], rollDef[1], { bonus: Number(p.bonusDice) || 0 });
      const pool = M.roll(info.count);
      const ev = M.judge(pool, Number(p.difficulty) || 2);
      if (ev.passed) outcome = 'resisted';
      else { const res = M.addState(actor.type, d, st.state, { rounds: st.rounds, ...stateCtx(cs) }); outcome = res.ok ? 'applied' : 'immune'; }
      card(user, { card: 'test', title: `Resistir a ${st.name} (${M.attrName(rollDef[0])} + ${M.skillName(rollDef[1])})`, actor: actor.name, pool: poolView(pool, ev, info.parts), notes: [outcome === 'resisted' ? 'Resistiu!' : `${st.name} aplicado.`] });
    }
    actor.data = d; save(actor);
    const results = clone(msg.data.results);
    results[p.index].pendingStates[p.stateIndex].resolved = outcome;
    const updated = store.chat.update(msg.id, { results });
    world.updateMessage(updated);
  }

  function undoDamage(user, p) {
    if (user.role !== 'gm') fail('Apenas o Mestre.');
    const msg = store.chat.get(Number(p.msgId));
    const r = msg?.data?.results?.[Number(p.index)];
    if (!r || !r.dealt || r.undone) fail('Nada a desfazer.');
    const actor = getActor(r.targetActorId);
    const d = clone(actor.data);
    const max = actor.type === 'hunter' ? model.derivedHunter(d).hpMax : d.hp?.max;
    M.healDamage(actor.type, d, r.dealt, max);
    actor.data = d; save(actor);
    const results = clone(msg.data.results);
    results[p.index].undone = true;
    world.updateMessage(store.chat.update(msg.id, { results }));
  }

  // ================================================================
  // Morte, velas e descanso
  // ================================================================
  // Muda as velas; retorna { dead, stable, woke }
  function candleChange(d, { lit = 0, out = 0 }) {
    const dy = d.dying || { lit: 0, out: 0, parasiteUsed: false, stable: false };
    const n = R().combat.dying.candles;
    dy.lit = Math.min(n, dy.lit + lit);
    dy.out = Math.min(n, dy.out + out);
    d.dying = dy;
    if (dy.lit >= n) dy.stable = true;
    if (dy.out >= n) dy.deathPending = true;
    return { dead: dy.out >= n, stable: dy.stable };
  }

  function candleRoll(user, actor) {
    const d = clone(actor.data);
    if (!d.dying) fail('Este caçador não está Morrendo.');
    if (d.dying.stable) fail('Estabilizado: não rola mais até ser curado ou descansar.');
    const rd = R().combat.dying;
    const info = M.hunterPool(d, rd.roll[0], rd.roll[1]);
    const pool = M.roll(info.count);
    const notes = [];
    if (pool.critFail?.isCrit) { candleChange(d, { out: 2 }); notes.push('Falha Crítica: <b>duas velas se apagam</b>.'); }
    else if (pool.successes === 0) { candleChange(d, { out: 1 }); notes.push('Nenhum sucesso: <b>uma vela se apaga</b>.'); }
    else if (pool.successes >= rd.wakeSuccesses) {
      d.dying = null; M.removeState(d, 'morrendo');
      d.hp = { value: 1 };
      notes.push('<b>O corpo vence!</b> Desperta com 1 de Vida, ainda Prostratus.');
    } else { candleChange(d, { lit: 1 }); notes.push('<b>Uma vela se acende.</b>'); }
    if (d.dying?.stable) notes.push('Três velas acesas: <b>estabilizado</b> (inconsciente, 0 de Vida).');
    if (d.dying?.deathPending) notes.push('Três velas apagadas: <b>o Sonho o chama</b>. O parasita pode segurá-lo uma vez (+2 Dementia).');
    actor.data = d; save(actor);
    return card(user, { card: 'dying', title: 'À beira do Sonho', actor: actor.name, actorId: actor.id, pool: poolView(pool, null, info.parts), dying: d.dying, notes });
  }

  function parasiteHold(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const d = clone(actor.data);
    if (!d.dying || d.dying.parasiteUsed || d.dying.out < 1) fail('Não disponível.');
    d.dying.out -= 1; d.dying.lit += 1; d.dying.parasiteUsed = true; d.dying.deathPending = false;
    if (d.dying.lit >= R().combat.dying.candles) d.dying.stable = true;
    const before = d.dementia || 0;
    d.dementia = Math.min(R().dementia.max, before + R().combat.dying.parasiteDementia);
    const notes = [`O parasita não quer perder o hospedeiro: a vela se acende. +${R().combat.dying.parasiteDementia} Dementia (${d.dementia}).`, ...stageNotes(d, before, d.dementia)];
    actor.data = d; save(actor);
    card(user, { card: 'info', title: 'O parasita segura', actor: actor.name, text: notes.join('<br>') });
  }

  // Morte: Ecos ficam no cadáver (marcador no mapa), +Dementia, desperta no Sonho.
  function death(user, p) {
    if (user.role !== 'gm') fail('Apenas o Mestre confirma a morte.');
    const actor = getActor(p.actorId);
    if (actor.type !== 'hunter') fail('Apenas caçadores despertam no Sonho.');
    const d = clone(actor.data);
    const mods = model.modifiers(d, 'hunter');
    const dm = mods.deathDementia ?? R().between.death.dementia;
    const ecos = d.ecos || 0;
    const before = d.dementia || 0;
    d.dementia = Math.min(R().dementia.max, before + dm);
    d.ecos = 0;
    // Perde efeitos temporários (mantém mutações, memórias e Discernimento).
    d.states = [];
    d.dying = null;
    d.defense = null;
    d.selfCoatings = [];
    for (const w of d.weapons) w.coating = null;
    const dv = model.derivedHunter(d);
    d.hp = { value: dv.hpMax };           // desperta no Sonho: descanso completo
    d.guard = { value: dv.guardMax };
    const notes = [`+${dm} Dementia (${d.dementia}).`, ...stageNotes(d, before, d.dementia)];
    // Marcador do cadáver com os Ecos
    const tok = tokenOfActor(actor);
    if (tok) {
      const corpse = store.tokens.create({ scene_id: tok.scene_id, actor_id: null, data: {
        x: tok.data.x, y: tok.data.y, size: tok.data.size || 1, name: `Cadáver de ${actor.name}`, img: tok.data.img, hidden: false, showName: 'all',
        disposition: 'corpse', ecos, owner: actor.id, vision: { enabled: false, range: null, dim: 0 }, light: { radius: 0, color: '#ffc36b' }, rotation: 90
      } });
      world.emitScene(tok.scene_id, 'token:create', (u) => world.tokenView(corpse, u));
      notes.push(`🩸 Um cadáver com <b>${ecos} Ecos</b> ficou no mapa. Volte até ele para recuperá-los.`);
    }
    actor.data = d; save(actor);
    card(user, { card: 'info', kind: 'death', title: '☠ Morte — o Sonho do Caçador', actor: actor.name, text: `${esc(actor.name)} morreu e desperta no Sonho do Caçador.<br>${notes.join('<br>')}` });
  }

  // Recuperar os Ecos do próprio cadáver.
  function recoverEcos(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const corpse = store.tokens.get(Number(p.tokenId));
    if (!corpse || corpse.data.disposition !== 'corpse') fail('Não é um cadáver.');
    if (corpse.data.owner && corpse.data.owner !== actor.id && user.role !== 'gm') fail('Este não é o seu cadáver.');
    const d = clone(actor.data);
    const amount = corpse.data.ecos || 0;
    d.ecos = (d.ecos || 0) + amount;
    actor.data = d; save(actor);
    store.tokens.remove(corpse.id);
    world.emitScene(corpse.scene_id, 'token:delete', { id: corpse.id });
    card(user, { card: 'info', title: 'Ecos recuperados', actor: actor.name, text: `${esc(actor.name)} recupera <b>${amount} Ecos de Sangue</b> do próprio cadáver.` });
  }

  function rest(user, p) {
    if (user.role !== 'gm') fail('O Mestre decide quando há descanso.');
    const ids = p.actorIds && p.actorIds.length ? p.actorIds : store.actors.list().filter(a => a.type === 'hunter' && a.owner_id).map(a => a.id);
    const lines = [];
    for (const id of ids) {
      const actor = getActor(id);
      if (actor.type !== 'hunter') continue;
      const d = clone(actor.data);
      const dv = model.derivedHunter(d);
      const before = d.hp.value;
      const heal = p.dream && R().between.rest.fullHpInDream ? dv.hpMax : Math.floor(dv.hpMax * R().between.rest.hpFraction);
      M.healDamage('hunter', d, heal, dv.hpMax);
      d.guard = { value: dv.guardMax };
      d.arcana.cooldowns = {};
      d.rest = {};
      if ((d.states || []).some(s => s.id === 'torpor' && s.source === 'adrenalina')) M.removeState(d, 'torpor');
      if (d.dying?.stable) { d.dying = null; M.removeState(d, 'morrendo'); }
      actor.data = d; save(actor);
      lines.push(`${esc(actor.name)}: Vida ${before} → ${d.hp.value}, Guarda cheia.`);
    }
    card(user, { card: 'info', title: p.dream ? 'Descanso no Sonho do Caçador' : 'Descanso', text: `${lines.join('<br>')}<br><i>${esc(R().between.rest.text)}</i>` });
  }

  // Fases de Chefe: Postura Elevada (+1 Limiar por 2 turnos).
  function advancePhase(user, p) {
    if (user.role !== 'gm') fail('Apenas o Mestre.');
    const actor = getActor(p.actorId);
    const d = clone(actor.data);
    const next = (d.phase || 1) + 1;
    const ph = (d.phases || []).find(x => x.phase === next);
    const bp = R().combat.bossPhase;
    const cs = combatStatus(actor);
    d.phase = next;
    const rounds = ph?.rounds ?? bp.rounds;
    M.addState('creature', d, bp.state, { rounds, value: ph?.limiarBonus ?? bp.limiarBonus, ...stateCtx(cs) });
    actor.data = d; save(actor);
    card(user, { card: 'info', title: `${actor.name}: ${ph?.name || `Fase ${next}`}`, text: `${ph?.text ? esc(ph.text) + '<br>' : ''}<b>Postura Elevada</b>: +${ph?.limiarBonus ?? bp.limiarBonus} Limiar por ${rounds} turnos.` });
  }

  function milestoneSanity(user, p) {
    const actor = getActor(p.actorId);
    ensureControl(user, actor);
    const red = R().dementia.milestoneReduction;
    const d = clone(actor.data);
    const dm = R().dementia;
    const dv = model.derivedHunter(d);
    const extra = dv.sanityDice ? [{ dice: dv.sanityDice, label: `Resistência a Dementia +${dv.sanityDice}` }] : [];
    const info = M.hunterPool(d, dm.sanityRoll[0], dm.sanityRoll[1], { extraParts: extra });
    const pool = M.roll(info.count);
    const ev = M.judge(pool, red.difficulty);
    const notes = [];
    if (ev.passed) { d.dementia = Math.max(0, (d.dementia || 0) - red.reduce); notes.push(`A mente se reorganiza: -${red.reduce} Dementia (${d.dementia}). As mutações permanecem.`); }
    else notes.push('Nada muda. A Dementia quase nunca recua.');
    actor.data = d; save(actor);
    card(user, { card: 'test', title: 'Marco de Discernimento: Sanidade Difícil', actor: actor.name, pool: poolView(pool, ev, info.parts), notes });
  }

  // ================================================================
  // Ganchos do combate (chamados pelo núcleo)
  // ================================================================
  function initCombatant(actor) {
    const d = clone(actor.data);
    d.turn = {};
    d.combatFlags = {};
    d.defense = null;
    if (actor.type === 'hunter') d.pa = { value: R().combat.pa.start };
    else d.pa = { value: d.pa?.max ?? model.derivedCreature(d).paMax, max: d.pa?.max ?? model.derivedCreature(d).paMax };
    d.paPenalty = 0;
    actor.data = d; save(actor);
  }

  function onCombatCreate(combat) {
    for (const cb of store.combat.combatants(combat.id)) initCombatant(getActor(cb.actor_id));
  }
  function onCombatantAdded(combat, cb, actor) {
    if (combat.data.started !== undefined) initCombatant(model.normalize(actor));
  }

  function combatSide(token, actor) {
    return actor.type === 'hunter' ? 'hunters' : 'creatures';
  }

  async function rollInitiative(combat, { actorId, user }) {
    const ini = R().combat.initiative;
    const hunters = store.combat.combatants(combat.id).map(c => getActor(c.actor_id)).filter(a => a.type === 'hunter');
    if (!hunters.length) { world.systemMessage('Sem caçadores no combate: as criaturas começam.'); return 'creatures'; }
    let chosen = actorId ? hunters.find(h => h.id === Number(actorId)) : null;
    if (!chosen) {
      chosen = hunters.map(h => { const dv = model.derivedHunter(h.data); return { h, v: (dv.attributes[ini.attribute] || 0) + (dv.skills[ini.skill] || 0) }; }).sort((a, b) => b.v - a.v)[0].h;
    }
    const d = clone(chosen.data);
    const info = M.hunterPool(d, ini.attribute, ini.skill);
    const pool = M.roll(info.count);
    const ev = M.judge(pool, ini.difficulty);
    chosen.data = d; save(chosen);
    card(user, { card: 'test', title: 'Iniciativa (Percepção + Investigação)', actor: chosen.name, pool: poolView(pool, ev, info.parts), notes: [ev.passed ? 'Os <b>caçadores</b> agem primeiro.' : 'As <b>criaturas</b> começam.'] });
    return ev.passed ? 'hunters' : 'creatures';
  }

  function onSideStart(combat, side) {
    const lines = [];
    for (const cb of store.combat.combatants(combat.id)) {
      if (cb.data.side !== side) continue;
      const actor = getActor(cb.actor_id);
      const d = clone(actor.data);
      const name = esc(actor.name);
      // Estados que duram "até o início do próximo turno"
      d.states = (d.states || []).filter(s => !(s.expireAtStart && !(s.appliedRound === combat.data.round && s.appliedSide === side)));
      // Dano contínuo
      for (const s of [...(d.states || [])]) {
        const def = model.stateDef(s.id);
        if (!def?.dot) continue;
        const [r] = M.rollParts([def.dot]);
        if (actor.type === 'hunter' && d.dying) { lines.push(`${name}: ${def.name} (Morrendo, sem efeito extra).`); continue; }
        const res = M.dealDamage(actor.type, d, r.amount);
        lines.push(`${def.icon || ''} ${name} sofre <b>${res.dealt}</b> ${def.dot.type} de ${def.name} (Vida ${res.hpAfter}).${res.fell ? ' <b>Morrendo!</b>' : ''}${res.defeated ? ' <b>Abatida!</b>' : ''}`);
      }
      if (actor.type === 'hunter') {
        const dv = model.derivedHunter(d);
        const mods = dv.mods;
        // Na primeira rodada todos começam com o PA inicial; depois recuperam por turno.
        let pa = combat.data.round <= 1 ? (d.pa?.value ?? R().combat.pa.start) : (d.pa?.value || 0) + dv.paRecovery;
        if (mods.paTurnStart) pa = Math.max(pa, mods.paTurnStart);
        pa = Math.min(dv.paMax, pa) - (d.paPenalty || 0);
        d.pa = { value: Math.max(0, pa) };
        if (d.paPenalty) lines.push(`${name}: -${d.paPenalty} PA (desestabilizado).`);
        d.paPenalty = 0;
        if (!d.turn?.guardLost && !M.hasState(d, 'fractura') && (d.guard?.value ?? 0) < dv.guardMax) d.guard = { value: Math.min(dv.guardMax, (d.guard?.value || 0) + R().combat.guard.regenPerTurnIfNoLoss) };
        d.defense = null;
        d.turn = {};
        if (M.hasState(d, 'fractura')) lines.push(`✖ ${name} está em Fractura e perde este turno.`);
        actor.data = d; save(actor);
        if (d.dying && !d.dying.stable) candleRoll(null, getActor(actor.id));
      } else {
        const max = d.pa?.max ?? model.derivedCreature(d).paMax;
        d.pa = { value: d.fracturedSkip ? 0 : Math.max(0, max - (d.paPenalty || 0)), max };
        if (d.fracturedSkip) lines.push(`✖ ${name} está em Fractura: sem PA neste turno.`);
        else if (d.paPenalty) lines.push(`${name}: -${d.paPenalty} PA (desestabilizada).`);
        d.fracturedSkip = false;
        d.paPenalty = 0;
        d.turn = {};
        for (const ab of d.abilities || []) {
          if (ab.aura && (d.hp?.value ?? 1) > 0) {
            const [r] = M.rollParts([{ dice: ab.aura.dice, type: ab.aura.type }]);
            lines.push(`🔥 ${name} — ${esc(ab.name)}: <b>${r.amount} ${r.type}</b> em todos a até ${ab.aura.radius} m (use Aplicar dano).`);
          }
        }
        actor.data = d; save(actor);
      }
    }
    if (lines.length) card(null, { card: 'info', title: `Início do turno ${side === 'hunters' ? 'dos caçadores' : 'das criaturas'}`, text: lines.join('<br>') });
  }

  function onSideEnd(combat, side) {
    const lines = [];
    for (const cb of store.combat.combatants(combat.id)) {
      if (cb.data.side !== side) continue;
      const actor = getActor(cb.actor_id);
      const d = clone(actor.data);
      const keep = [];
      for (const s of d.states || []) {
        const sameTurn = s.appliedRound === combat.data.round && s.appliedSide === side;
        if (s.rounds == null || sameTurn || s.expireAtStart) { keep.push(s); continue; }
        const left = s.rounds - 1;
        if (left > 0) keep.push({ ...s, rounds: left });
        else {
          lines.push(`${esc(actor.name)}: ${model.stateDef(s.id)?.name || s.id} terminou.`);
          if (s.id === 'fractura' && actor.type === 'hunter' && R().combat.guard.resetOnFractureEnd) d.guard = { value: model.derivedHunter(d).guardMax };
        }
      }
      d.states = keep;
      for (const w of d.weapons || []) {
        if (!w.coating) continue;
        w.coating.rounds -= 1;
        if (w.coating.rounds <= 0) { lines.push(`${esc(actor.name)}: revestimento ${esc(w.coating.name)} acabou.`); w.coating = null; }
      }
      d.selfCoatings = (d.selfCoatings || []).map(c => ({ ...c, rounds: c.rounds - 1 })).filter(c => c.rounds > 0);
      actor.data = d; save(actor);
    }
    if (lines.length) card(null, { card: 'info', title: 'Fim do turno', text: lines.join('<br>') });
  }

  function onCombatEnd(combat) {
    for (const cb of store.combat.combatants(combat.id)) {
      const actor = store.actors.get(cb.actor_id);
      if (!actor) continue;
      const d = clone(actor.data);
      if (actor.type === 'hunter') {
        if (R().combat.guard.resetOnCombatEnd) d.guard = { value: model.derivedHunter(d).guardMax };
        if (M.hasState(d, 'adrenalina')) { M.removeState(d, 'adrenalina'); M.addState('hunter', d, 'torpor', { rounds: null, source: 'adrenalina' }); }
        d.states = (d.states || []).filter(s => s.id !== 'fractura');
        d.pa = { value: R().combat.pa.start };
      }
      d.defense = null; d.turn = {}; d.combatFlags = {}; d.paPenalty = 0; d.fracturedSkip = false;
      d.arcana && (d.arcana.cooldowns = {});
      actor.data = d; save(actor);
    }
  }

  // ================================================================
  // Comandos de chat do sistema
  // ================================================================
  function speakerActor(user, actorId) {
    if (actorId) {
      const a = store.actors.get(Number(actorId));
      if (a && world.canControlActor(user, a)) return model.normalize(a);
    }
    const own = store.actors.list().find(a => a.owner_id === user.id && a.type === 'hunter');
    if (own) return model.normalize(own);
    fail(user.role === 'gm' ? 'Abra/selecione uma ficha (ou token) para rolar por ela.' : 'Você ainda não tem um caçador vinculado.');
  }

  // "/teste Vigor+Resiliência 2 +1" → atributo, perícia, dificuldade, bônus
  function parseTest(arg) {
    let text = ' ' + M.norm(arg).replace(/\+/g, ' + ') + ' ';
    let attribute = null, skill = null;
    const skills = [...R().attributes.skills].sort((a, b) => b.name.length - a.name.length);
    for (const s of skills) {
      for (const n of [s.name, ...(s.aliases || [])]) {
        const k = ' ' + M.norm(n) + ' ';
        if (text.includes(k)) { skill = s.id; text = text.replace(k, ' § '); break; }
      }
      if (skill) break;
    }
    for (const a of R().attributes.attributes) {
      for (const n of [a.name, a.id, a.abbr]) {
        const k = ' ' + M.norm(n) + ' ';
        if (text.includes(k)) { attribute = a.id; text = text.replace(k, ' § '); break; }
      }
      if (attribute) break;
    }
    if (!attribute && skill) attribute = R().attributes.skills.find(s => s.id === skill).attribute;
    // O "+" entre Atributo e Perícia não é bônus.
    text = text.replace(/§\s*\+\s*§/g, ' ').replace(/§/g, ' ');
    let bonus = 0, difficulty = null;
    const tokens = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if ((t === '+' || t === '-') && /^\d+$/.test(tokens[i + 1] || '')) { bonus += (t === '+' ? 1 : -1) * Number(tokens[i + 1]); i++; continue; }
      if (/^[+-]\d+$/.test(t)) { bonus += Number(t); continue; }
      if (/^\d+$/.test(t) && difficulty == null) { difficulty = Number(t); continue; }
      const dif = [...R().core.difficulties, ...R().dementia.sanityDifficulties].find(x => M.norm(x.name) === t || x.id === t);
      if (dif) difficulty = dif.successes;
    }
    return { attribute, skill, bonus, difficulty };
  }

  const commands = {
    '/teste': ({ arg, user, actorId, blind }) => {
      const actor = speakerActor(user, actorId);
      const t = parseTest(arg);
      if (!t.attribute) fail('Use: /teste Atributo+Perícia [dificuldade] [+bônus]. Ex.: /teste Vigor+Resiliência 2');
      return doTest(user, actor, { ...t, blind });
    },
    '/sanidade': ({ arg, user, actorId, blind }) => {
      const actor = speakerActor(user, actorId);
      const t = parseTest(arg);
      return doSanity(user, actor, { difficulty: t.difficulty ?? 2, bonus: t.bonus, blind });
    },
    '/pool': ({ arg, user, blind }) => {
      const [n, dif] = String(arg).trim().split(/\s+/).map(Number);
      if (!Number.isFinite(n) || n < 0 || n > 60) fail('Use: /pool N [dificuldade]');
      const pool = M.roll(n);
      const ev = Number.isFinite(dif) ? M.judge(pool, dif) : null;
      return card(user, { card: 'test', title: `Pool de ${n}D6`, pool: poolView(pool, ev, [`${n}D6`]) }, { blind });
    },
    '/ataque': async ({ arg, user, actorId, targets }) => {
      const actor = speakerActor(user, actorId);
      const text = M.norm(arg);
      const mode = /visceral/.test(text) ? 'visceral' : /pesad/.test(text) ? 'heavy' : 'basic';
      const trigger = /gatilho|transforma|truque/.test(text);
      const d = actor.data;
      let weapon = d.equip.main;
      if (/desarmad|soco/.test(text)) weapon = 'unarmed';
      else {
        const all = [...d.weapons.map(w => ({ uid: w.uid, name: model.weaponRef(w)?.name })), ...d.revolvers.map(r => ({ uid: r.uid, name: model.revolverRef(r)?.name }))];
        const hit = all.find(w => w.name && text.includes(M.norm(w.name))) || (/revolver|tiro|disparo|pistola/.test(text) ? all.find(w => d.revolvers.some(r => r.uid === w.uid)) : null);
        if (hit) weapon = hit.uid;
      }
      return hunterAttack(user, { actorId: actor.id, weapon, mode, trigger, targets });
    },
    '/velas': ({ user, actorId }) => candleRoll(user, speakerActor(user, actorId)),
    '/dano': ({ arg, user }) => {
      const m = String(arg).trim().match(/^(\S+)\s*(\S+)?/);
      const r = m && M.rollFormula(m[1]);
      if (!r) fail('Use: /dano 2d6 Ignis');
      const type = m[2] ? R()['damage-types'].types.find(t => M.norm(t.id) === M.norm(m[2]))?.id : null;
      return card(user, { card: 'damage', title: 'Dano', formula: m[1], type, total: r.total, line: M.fmtRoll(r) });
    },
    '/cura': ({ arg, user }) => {
      const r = M.rollFormula(String(arg).trim() || '1d6');
      if (!r) fail('Use: /cura 1d6');
      return card(user, { card: 'damage', heal: true, title: 'Cura', formula: arg, total: r.total, line: M.fmtRoll(r) });
    }
  };
  commands['/t'] = commands['/teste'];
  commands['/test'] = commands['/teste'];
  commands['/san'] = commands['/sanidade'];
  commands['/atk'] = commands['/ataque'];

  const help = [
    '<b>/teste Vigor+Resiliência [dif] [+N]</b> — pool pela ficha (5 e 6 são sucessos, 6 explode)',
    '<b>/sanidade [dif]</b> — teste de Sanidade (falha aplica Dementia)',
    '<b>/ataque [arma] [pesado|visceral|gatilho]</b> — contra o alvo marcado (tecla T)',
    '<b>/pool N [dif]</b> — pool livre de N dados',
    '<b>/dano 2d6 Ignis</b>, <b>/cura 1d6</b> — cartão com botões de aplicar',
    '<b>/velas</b> — rolagem de Morrendo (À beira do Sonho)'
  ];

  // ================================================================
  // Socket: ações da ficha e reações
  // ================================================================
  function registerSocket({ on }) {
    on('sys:action', async (p, user) => {
      switch (p.action) {
        case 'test': { const a = getActor(p.actorId); ensureControl(user, a); return void doTest(user, a, { attribute: p.attribute, skill: p.skill, difficulty: p.difficulty === '' || p.difficulty == null ? null : Number(p.difficulty), bonus: Number(p.bonus) || 0, blind: !!p.blind && user.role === 'gm', label: p.label }); }
        case 'sanity': { const a = getActor(p.actorId); ensureControl(user, a); return void doSanity(user, a, { difficulty: Number(p.difficulty) || 2, bonus: Number(p.bonus) || 0 }); }
        case 'attack': return void (await hunterAttack(user, p));
        case 'creatureAttack': return void (await creatureAttack(user, p));
        case 'creatureRoll': { const a = getActor(p.actorId); if (user.role !== 'gm') fail('Apenas o Mestre.'); return void doTest(user, a, { difficulty: p.difficulty ? Number(p.difficulty) : null, bonus: Number(p.bonus) || 0, label: p.label || 'Rolagem de criatura', blind: !!p.blind }); }
        case 'cast': return void (await castArcane(user, p));
        case 'mark': return void (await useMark(user, p));
        case 'defend': return void defend(user, p);
        case 'generic': return void genericAction(user, p);
        case 'hands': return void handsAction(user, p);
        case 'flask': return void drinkFlask(user, p);
        case 'useItem': return void useItem(user, p);
        case 'prepare': return void prepareArcana(user, p);
        case 'adjust': return void adjust(user, p);
        case 'state': return void setState(user, p);
        case 'resist': return void resistState(user, p);
        case 'undo': return void undoDamage(user, p);
        case 'candles': { const a = getActor(p.actorId); ensureControl(user, a); return void candleRoll(user, a); }
        case 'parasite': return void parasiteHold(user, p);
        case 'death': return void death(user, p);
        case 'recoverEcos': return void recoverEcos(user, p);
        case 'rest': return void rest(user, p);
        case 'phase': return void advancePhase(user, p);
        case 'milestoneSanity': return void milestoneSanity(user, p);
        case 'autoApply': if (user.role !== 'gm') fail('Apenas o Mestre.'); store.settings.set('duskbloods.autoApply', !!p.value); rt.emitGM('sys:settings', { autoApply: !!p.value }); return;
        case 'settings': return { autoApply: autoApply() };
        case 'derived': { const a = getActor(p.actorId); ensureControl(user, a); return { derived: model.derived(a) }; }
        default: fail('Ação desconhecida.');
      }
    }, { player: true });

    // Resposta à oferta de Contra-Tiro (dono do caçador ou Mestre).
    on('sys:react', ({ id, use }, user) => {
      const pend = pending.get(id);
      if (!pend) return { error: 'Tarde demais: o golpe já aconteceu.' };
      if (user.role !== 'gm' && user.id !== pend.ownerId) fail('Esta reação não é sua.');
      pend.resolve(!!use);
    });
  }

  // ================================================================
  // Visões e validações usadas pelo núcleo
  // ================================================================
  function decorate(actor) {
    const a = model.normalize({ ...actor, data: clone(actor.data) });
    return { ...a, derived: model.derived(a) };
  }

  // Após editar a ficha: avisos de estágio de Dementia e marcos de Discernimento.
  function applyActorUpdate(actor, patch, user) {
    const before = model.normalize(actor);
    if (patch.data && user.role !== 'gm') {
      const cs = combatStatus(actor);
      if (patch.data.arcana?.prepared && JSON.stringify(patch.data.arcana.prepared) !== JSON.stringify(before.data.arcana.prepared)) {
        if (cs.inCombat) fail('Trocar Arcanos preparados exige descanso ou a Oficina (fora de combate).');
        const slots = model.derivedHunter({ ...before.data, ...patch.data }).spellSlots;
        if (patch.data.arcana.prepared.length > slots) fail(`Você tem ${slots} Espaço(s) de Magia.`);
      }
      if (cs.inCombat && patch.data.equip) fail('Em combate, use as ações Sacar/Guardar/Trocar (custam PA).');
      if (cs.inCombat && patch.data.weapons && patch.data.weapons.some(w => before.data.weapons.find(x => x.uid === w.uid && x.form !== w.form))) fail('Em combate, a troca de forma acontece junto de um ataque.');
    }
    const updated = store.actors.update(actor.id, patch);
    const after = model.normalize(updated);
    if (actor.type === 'hunter' && patch.data) {
      const d = clone(after.data);
      const notes = [];
      if (patch.data.dementia !== undefined && d.dementia > (before.data.dementia || 0)) notes.push(...stageNotes(d, before.data.dementia || 0, d.dementia));
      if (patch.data.discernment !== undefined && d.discernment > (before.data.discernment || 0)) notes.push(...discernmentNotes(before.data.discernment || 0, d.discernment));
      if (notes.length) {
        const saved = store.actors.update(actor.id, { data: d }, true);
        card(null, { card: 'info', title: after.name, text: notes.join('<br>') });
        world.broadcastActor(saved);
        return saved;
      }
    }
    world.broadcastActor(updated);
    return updated;
  }

  // Bloqueia movimento de quem está Immotus (jogadores).
  function canMove(token) {
    if (!token.actor_id) return null;
    const a = store.actors.get(token.actor_id);
    if (!a) return null;
    if ((a.data.states || []).some(s => s.id === 'immotus')) return 'Immotus: não pode se deslocar.';
    if (a.data.dying) return 'Morrendo: não consegue se mover.';
    return null;
  }

  return {
    model, mechanics: M,
    defaultActorData: (type, input) => model.defaultActorData(type, input),
    creatureFromCompendium: (entry) => model.creatureFromCompendium(entry),
    sanitizeUpdate: (actor, patch, user) => model.sanitizeUpdate(model.normalize(actor), patch, user),
    publicActorData: (actor) => model.publicActorData(model.normalize(actor)),
    decorate, applyActorUpdate, canMove,
    combatSide, onCombatCreate, onCombatantAdded, rollInitiative, onSideStart, onSideEnd, onCombatEnd,
    commands, help, registerSocket,
    // Expostos para testes automatizados
    _internal: { hunterAttack, creatureAttack, castArcane, useMark, doTest, doSanity, resolveCounterShot, candleRoll, death, pending }
  };
}

module.exports = { createEngine };
