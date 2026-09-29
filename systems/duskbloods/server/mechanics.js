// Mecânicas do DuskBloods: pools, Limiar, dano, estados, PA e Guarda.
// Funções puras sobre os dados da ficha (d = actor.data), sem acesso ao banco.
const { rollPool, evaluate, rollParts, rollFormula } = require('./pool');

function createMechanics(system, model) {
  const R = () => system.rules;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function userError(msg) { const e = new Error(msg); e.userMessage = msg; return e; }

  // --------------------------------------------------------------
  // Busca de atributos/perícias por nome (para /teste Vigor+Resiliência)
  // --------------------------------------------------------------
  function findAttribute(text) {
    const t = norm(text);
    return R().attributes.attributes.find(a => norm(a.name) === t || a.id === t || norm(a.abbr) === t) || null;
  }
  function findSkill(text) {
    const t = norm(text);
    return R().attributes.skills.find(s => norm(s.name) === t || s.id === t || (s.aliases || []).map(norm).includes(t)) || null;
  }
  const attrName = (id) => R().attributes.attributes.find(a => a.id === id)?.name || id;
  const skillName = (id) => R().attributes.skills.find(s => s.id === id)?.name || id;

  // --------------------------------------------------------------
  // Pool de um caçador: Atributo + Perícia (+ bônus). Consome Vantagem/Desvantagem.
  // --------------------------------------------------------------
  function hunterPool(d, attribute, skill, { bonus = 0, extraParts = [], consume = true } = {}) {
    const dv = model.derivedHunter(d);
    const parts = [];
    let count = 0;
    if (attribute) { count += dv.attributes[attribute] || 0; parts.push(`${attrName(attribute)} ${dv.attributes[attribute] || 0}`); }
    if (skill) {
      const sv = dv.skills[skill] || 0;
      count += sv;
      if (sv) parts.push(`${skillName(skill)} ${sv > 0 ? '+' : ''}${sv}`);
      else parts.push(`sem ${skillName(skill)}`);
    }
    if (dv.mods.dice) { count += dv.mods.dice; parts.push(`${dv.mods.dice > 0 ? 'Vantagem +' : 'Desvantagem '}${dv.mods.dice}`); }
    for (const p of extraParts) { count += p.dice; parts.push(p.label); }
    if (bonus) { count += bonus; parts.push(`Bônus ${bonus > 0 ? '+' : ''}${bonus}`); }
    if (consume) consumeRollStates(d);
    return { count: Math.max(R().core.minimumPool || 0, count), parts };
  }

  function creaturePool(d, { bonus = 0, extraParts = [], consume = true } = {}) {
    const dv = model.derivedCreature(d);
    let count = dv.dice || 0;
    const parts = [`Dados ${dv.dice}`];
    if (dv.mods.dice) { count += dv.mods.dice; parts.push(`Vantagem/Desvantagem ${dv.mods.dice > 0 ? '+' : ''}${dv.mods.dice}`); }
    for (const p of extraParts) { count += p.dice; parts.push(p.label); }
    if (bonus) { count += bonus; parts.push(`Bônus ${bonus > 0 ? '+' : ''}${bonus}`); }
    if (consume) consumeRollStates(d);
    return { count: Math.max(0, count), parts };
  }

  function consumeRollStates(d) {
    d.states = (d.states || []).filter(s => !model.stateDef(s.id)?.consumeOnRoll);
  }

  function roll(count) { return rollPool(count, R().core); }
  function judge(pool, target) { return evaluate(pool, target, R().core); }

  // --------------------------------------------------------------
  // Limiar do alvo (com Cobertura). Consome Apertus.
  // --------------------------------------------------------------
  function limiarOf(actor, { cover = 0, consume = true } = {}) {
    const d = actor.data;
    const dv = actor.type === 'hunter' ? model.derivedHunter(d) : model.derivedCreature(d);
    let value = dv.limiar;
    const parts = [...dv.limiarBreakdown];
    if (cover) { value += cover; parts.push(`Cobertura +${cover}`); }
    if (consume) d.states = (d.states || []).filter(s => !model.stateDef(s.id)?.consumeOnAttackReceived);
    return { value: Math.max(0, value), parts };
  }

  // --------------------------------------------------------------
  // Dano: Dano Base (multiplicável) + Excedentes + fixos (não multiplicados)
  // + Dano de Truque + Revestimentos; Fraqueza +1d6; Resistência metade; Redução.
  // --------------------------------------------------------------
  function computeDamage({ base = [], multiplier = 1, excess = 0, fixed = [], trick = [], trickBonus = 0, coatings = [], target = null, massive = false, ignoreDr = 0, ignoreAllDr = false }) {
    const lines = [];
    const byType = new Map();
    const add = (type, amount) => byType.set(type, (byType.get(type) || 0) + amount);

    const baseRolled = rollParts(base);
    baseRolled.forEach((p, i) => {
      const v = p.amount * multiplier;
      add(p.type, v);
      lines.push(`${p.formula} ${p.type}: ${fmtRoll(p.roll)}${multiplier > 1 ? ` ×${multiplier} = ${v}` : ''}`);
    });
    const firstType = baseRolled[0]?.type || trick[0]?.type || 'Contusio';
    if (excess > 0) { add(firstType, excess); lines.push(`Sucessos Excedentes: +${excess}`); }
    for (const f of fixed) if (f.amount) { add(f.type || firstType, f.amount); lines.push(`${f.label}: +${f.amount} (não multiplica)`); }
    const trickRolled = rollParts(trick);
    trickRolled.forEach((p, i) => {
      const bonus = i === 0 ? trickBonus : 0;
      add(p.type, p.amount + bonus);
      lines.push(`Dano de Truque ${p.formula} ${p.type}: ${fmtRoll(p.roll)}${bonus ? ` +${bonus}` : ''} (não multiplica)`);
    });
    for (const c of coatings) {
      const [p] = rollParts([c]);
      add(p.type, p.amount);
      lines.push(`${c.label || 'Revestimento'} ${p.formula} ${p.type}: ${fmtRoll(p.roll)} (não multiplica)`);
    }

    // Fraquezas e resistências do alvo
    if (target) {
      const td = target.data;
      const weak = target.type === 'hunter' ? model.derivedHunter(td).weaknesses : (td.weaknesses || []);
      const res = target.type === 'hunter' ? [] : (td.resistances || []);
      const wr = R()['damage-types'];
      for (const type of [...byType.keys()]) {
        if (weak.includes(type)) {
          const r = rollFormula(wr.weakness.extraDice);
          add(type, r.total);
          lines.push(`Fraqueza a ${type}: +${r.total} (${wr.weakness.extraDice})`);
        }
      }
      for (const type of [...byType.keys()]) {
        if (res.includes(type)) {
          const before = byType.get(type);
          const after = Math.floor(before / wr.resistance.divisor);
          byType.set(type, after);
          lines.push(`Resistência a ${type}: ${before} → ${after}`);
        }
      }
    }

    let total = [...byType.values()].reduce((a, b) => a + b, 0);
    let dr = 0;
    if (target && !massive && !ignoreAllDr) {
      const tdv = target.type === 'hunter' ? model.derivedHunter(target.data) : model.derivedCreature(target.data);
      dr = Math.max(0, (tdv.dr || 0) - ignoreDr);
      if (dr) { lines.push(`Redução de Dano: -${dr}`); total = Math.max(0, total - dr); }
    }
    if (massive) lines.push('Dano Massivo: ignora Redução de Dano');
    return { total, byType: Object.fromEntries(byType), lines, types: [...byType.keys()] };
  }

  function fmtRoll(r) {
    if (!r) return '0';
    const dice = r.parts.filter(p => p.sides).flatMap(p => p.results);
    const flat = r.parts.filter(p => p.value !== undefined).reduce((a, p) => a + p.value * p.sign, 0);
    return `[${dice.join(', ')}]${flat ? (flat > 0 ? ` +${flat}` : ` ${flat}`) : ''} = ${r.total}`;
  }

  // --------------------------------------------------------------
  // Estados
  // --------------------------------------------------------------
  // ctxInfo: { round, side } do combate (para saber quando o estado foi aplicado)
  function addState(actorType, d, id, { rounds, value, source, expireAtStart, round = null, side = null } = {}) {
    const def = model.stateDef(id);
    if (!def) return { ok: false, reason: 'Estado desconhecido.' };
    const mods = actorType === 'hunter' ? model.modifiers(d, 'hunter') : model.modifiers(d, 'creature');
    if (def.category && (mods.immune || []).includes(def.category)) return { ok: false, reason: `imune (${def.category})` };
    if ((mods.immuneStates || []).includes(id)) return { ok: false, reason: 'imune' };
    if ((mods.immuneGroups || []).includes(def.group)) return { ok: false, reason: 'imune' };
    const r = rounds !== undefined && rounds !== null ? rounds : (def.rounds !== undefined && def.rounds !== null ? def.rounds : (def.untilRemoved ? null : R().states.defaultRounds));
    d.states = d.states || [];
    const existing = d.states.find(s => s.id === id);
    if (existing) {
      existing.rounds = existing.rounds == null || r == null ? (r == null ? null : existing.rounds) : Math.max(existing.rounds, r);
      if (value !== undefined) existing.value = def.id === 'firmamentum' ? Math.max(existing.value || 0, value) : value;
      existing.appliedRound = round; existing.appliedSide = side;
      if (expireAtStart) existing.expireAtStart = true;
    } else {
      d.states.push({ id, rounds: r, value, source, appliedRound: round, appliedSide: side, expireAtStart: !!expireAtStart });
    }
    // Criatura em Fractura perde o PA restante e todo o PA do próximo turno.
    if (id === 'fractura' && actorType === 'creature') {
      d.pa = { ...(d.pa || {}), value: 0 };
      d.fracturedSkip = true;
    }
    return { ok: true };
  }

  function removeState(d, id) {
    const before = (d.states || []).length;
    d.states = (d.states || []).filter(s => s.id !== id);
    return before !== d.states.length;
  }

  const hasState = (d, id) => (d.states || []).some(s => s.id === id);

  // --------------------------------------------------------------
  // Vida, Vida Temporária (Firmamentum), Morrendo
  // --------------------------------------------------------------
  // Retorna { dealt, absorbed, hpBefore, hpAfter, fell, defeated }
  function dealDamage(actorType, d, amount) {
    let remaining = Math.max(0, Math.floor(amount));
    let absorbed = 0;
    const temp = (d.states || []).find(s => s.id === 'firmamentum');
    if (temp && temp.value > 0 && remaining > 0) {
      absorbed = Math.min(temp.value, remaining);
      temp.value -= absorbed;
      remaining -= absorbed;
      if (temp.value <= 0) removeState(d, 'firmamentum');
    }
    const hpBefore = d.hp?.value ?? 0;
    const hpAfter = Math.max(0, hpBefore - remaining);
    d.hp = { ...(d.hp || {}), value: hpAfter };
    let fell = false;
    let defeated = false;
    if (actorType === 'hunter' && hpAfter <= 0 && !d.dying) {
      d.dying = { lit: 0, out: 0, parasiteUsed: false, stable: false };
      addState('hunter', d, 'morrendo', { rounds: null });
      addState('hunter', d, 'prostratus', { rounds: null });
      fell = true;
    }
    if (actorType === 'creature' && hpBefore > 0 && hpAfter <= 0) defeated = true;
    return { dealt: remaining, absorbed, hpBefore, hpAfter, fell, defeated };
  }

  function healDamage(actorType, d, amount, maxHp) {
    const before = d.hp?.value ?? 0;
    const after = Math.min(maxHp ?? before + amount, before + Math.max(0, Math.floor(amount)));
    d.hp = { ...(d.hp || {}), value: after };
    let revived = false;
    if (actorType === 'hunter' && d.dying && after > 0) {
      d.dying = null;
      removeState(d, 'morrendo');
      revived = true;
    }
    return { before, after, healed: after - before, revived };
  }

  // Guarda do caçador. Em 0: Fractura.
  function loseGuard(d, amount, ctxInfo) {
    if (amount <= 0) return { lost: 0 };
    const before = d.guard?.value ?? 0;
    const after = Math.max(0, before - amount);
    d.guard = { value: after };
    d.turn = { ...(d.turn || {}), guardLost: true };
    let fractured = false;
    if (after <= 0 && before > 0) {
      addState('hunter', d, R().combat.guard.zeroState, { rounds: 1, ...ctxInfo });
      fractured = true;
    }
    return { lost: before - after, before, after, fractured };
  }

  // PA desestabilizado: sai primeiro do PA guardado, o resto da próxima recuperação.
  function destabilize(actorType, d, amount) {
    if (amount <= 0) return 0;
    if (actorType === 'hunter') {
      const fromStored = Math.min(d.pa?.value || 0, amount);
      d.pa = { value: (d.pa?.value || 0) - fromStored };
      d.paPenalty = (d.paPenalty || 0) + (amount - fromStored);
    } else {
      d.paPenalty = (d.paPenalty || 0) + amount;
    }
    return amount;
  }

  return {
    norm, userError, findAttribute, findSkill, attrName, skillName,
    hunterPool, creaturePool, consumeRollStates, roll, judge, limiarOf,
    computeDamage, fmtRoll, addState, removeState, hasState, dealDamage, healDamage, loseGuard, destabilize,
    rollParts, rollFormula
  };
}

module.exports = { createMechanics };
