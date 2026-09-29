// Modelo de dados das fichas do DuskBloods: valores padrão, valores DERIVADOS
// (Vida máxima, Limiar, Espaços de Magia...) e validação de edições.
// Nada de número de regra fixo aqui: tudo vem de rules/*.json e compendium/*.json.
const crypto = require('crypto');

const uid = () => crypto.randomBytes(5).toString('hex');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);

function createModel(system) {
  const R = () => system.rules;
  const IDX = () => system.index;

  // ------------------------------------------------------------------
  // Dados padrão
  // ------------------------------------------------------------------
  function defaultHunter(input = {}) {
    const attrs = R().attributes;
    const cls = R().classes.classes.find(c => c.id === input.class) || R().classes.classes[0];
    const kit = R().between.startingKit;
    const d = {
      class: cls.id,
      classSkill: cls.classSkills[0],
      attributes: Object.fromEntries(attrs.attributes.map(a => [a.id, attrs.creation.attributeBase])),
      skills: Object.fromEntries(attrs.skills.map(s => [s.id, 0])),
      hp: { value: null },
      guard: { value: null },
      pa: { value: R().combat.pa.start },
      paPenalty: 0,
      discernment: 0,
      dementia: 0,
      humanitas: R().humanitas.start,
      flasks: kit.flasks,
      ecos: kit.ecos,
      mutationGrades: [],
      mutations: [],
      talents: [],
      arcana: { known: [], prepared: [], cooldowns: {} },
      marks: [],
      weapons: [],
      revolvers: [],
      channelers: [],
      equip: { main: null, off: null, offStowed: false, mainStowed: false },
      inventory: [],
      states: [],
      defense: null,
      dying: null,
      turn: {},
      combatFlags: {},
      rest: {},
      notes: '',
      biography: '',
      tokenSize: 1
    };
    // Perícia de classe gratuita em Proficiência I.
    d.skills[d.classSkill] = 1;
    // Kit inicial opcional (usado pelo assistente de criação).
    if (input.kit) {
      const w = input.kit.weapon && IDX().weapons[input.kit.weapon];
      if (w) {
        const inst = newWeapon(w);
        d.weapons.push(inst);
        d.equip.main = inst.uid;
      }
      if (input.kit.off === 'revolver') {
        const r = newRevolver(IDX().revolvers['revolver-de-cacador']);
        d.revolvers.push(r);
        d.equip.off = r.uid;
        d.inventory.push({ uid: uid(), ref: 'municao-comum', name: 'Munição comum', qty: kit.ammo });
      } else if (input.kit.off === 'channeler') {
        const c = newChanneler(IDX().channelers['canalizador-de-iniciado']);
        d.channelers.push(c);
        d.equip.off = c.uid;
      }
      for (const it of kit.items || []) {
        const ref = IDX().items[it.ref];
        d.inventory.push({ uid: uid(), ref: it.ref, name: ref ? ref.name : it.ref, qty: it.qty });
      }
    }
    return d;
  }

  function defaultCreature(input = {}) {
    const tiers = R().combat.creatureTiers;
    const tier = tiers.find(t => t.id === input.tier) || tiers[1];
    return {
      ref: null,
      category: '',
      tier: tier.id,
      limiar: tier.limiar,
      dice: tier.dice[0],
      hp: { value: 15, max: 15 },
      pa: { value: tier.pa, max: tier.pa },
      paPenalty: 0,
      ecos: '',
      weaknesses: [],
      resistances: [],
      dr: 0,
      attacks: [{ name: 'Ataque', pa: 2, damage: [{ dice: '1d6', type: 'Contusio' }] }],
      abilities: [],
      phases: [],
      phase: 1,
      states: [],
      hideStats: false,
      unknown: false,
      noOpportunity: false,
      maxAttacksPerTurn: tier.maxAttacksPerTurn || null,
      showBars: false,
      turn: {},
      notes: '',
      quote: '',
      text: '',
      tokenSize: tier.id === 'chefe' || tier.id === 'ascendente' ? 2 : 1
    };
  }

  function creatureFromCompendium(entry, opts = {}) {
    const base = defaultCreature({ tier: entry.tier });
    const tier = R().combat.creatureTiers.find(t => t.id === entry.tier) || R().combat.creatureTiers[1];
    const hp = entry.hp ?? null;
    return {
      ...base,
      ref: entry.id,
      category: entry.category || '',
      tier: tier.id,
      limiar: entry.limiar ?? null,
      dice: entry.dice ?? null,
      hp: { value: hp, max: hp },
      pa: { value: entry.pa ?? tier.pa, max: entry.pa ?? tier.pa },
      ecos: entry.ecos || '',
      weaknesses: [...(entry.weaknesses || [])],
      resistances: [...(entry.resistances || [])],
      dr: entry.dr || 0,
      attacks: JSON.parse(JSON.stringify(entry.attacks || [])),
      abilities: JSON.parse(JSON.stringify(entry.abilities || [])),
      phases: JSON.parse(JSON.stringify(entry.phases || [])),
      hideStats: !!entry.hideStats,
      unknown: !!entry.unknown,
      noOpportunity: !!entry.noOpportunity,
      maxAttacksPerTurn: entry.maxAttacksPerTurn || tier.maxAttacksPerTurn || null,
      hpPerHunter: entry.hpPerHunter || null,
      quote: entry.quote || '',
      text: entry.text || ''
    };
  }

  function newWeapon(ref) {
    const inst = { uid: uid(), ref: ref.id, form: 'padrao', reforco: 0, coating: null, charged: false };
    const f = ref.forms.padrao.ranged ? ref.forms.padrao : ref.forms.truque?.ranged ? ref.forms.truque : null;
    if (f) inst.ammo = f.ammoCapacity || 6;
    return inst;
  }
  function newRevolver(ref) { return { uid: uid(), ref: ref.id, ammo: ref.ammoCapacity || 6 }; }
  function newChanneler(ref) { return { uid: uid(), ref: ref.id, afinacao: 0 }; }

  function defaultActorData(type, input = {}) {
    if (type === 'hunter') {
      const d = defaultHunter(input);
      // Importação: mescla o que veio, mantendo estrutura.
      return mergeKnown(d, input);
    }
    return mergeKnown(defaultCreature(input), input);
  }

  function mergeKnown(base, input) {
    const out = { ...base };
    for (const [k, v] of Object.entries(input || {})) {
      if (k === 'kit') continue;
      if (v === undefined) continue;
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
        ? { ...base[k], ...v } : v;
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Consultas ao compêndio
  // ------------------------------------------------------------------
  const weaponRef = (inst) => inst && IDX().weapons[inst.ref];
  const revolverRef = (inst) => inst && IDX().revolvers[inst.ref];
  const channelerRef = (inst) => inst && IDX().channelers[inst.ref];
  const stateDef = (id) => R().states.states.find(s => s.id === id);
  const classDef = (d) => R().classes.classes.find(c => c.id === d.class) || R().classes.classes[0];

  function findItem(d, uidv) {
    return d.weapons.find(w => w.uid === uidv) ? { kind: 'weapon', inst: d.weapons.find(w => w.uid === uidv) }
      : d.revolvers.find(w => w.uid === uidv) ? { kind: 'revolver', inst: d.revolvers.find(w => w.uid === uidv) }
      : d.channelers.find(w => w.uid === uidv) ? { kind: 'channeler', inst: d.channelers.find(w => w.uid === uidv) }
      : null;
  }

  // Estado das mãos: o que está empunhado e pronto para uso.
  function hands(d) {
    const main = d.weapons.find(w => w.uid === d.equip.main) || null;
    const mainRef = weaponRef(main);
    const form = main && mainRef ? mainRef.forms[main.form] : null;
    const off = d.equip.off ? findItem(d, d.equip.off) : null;
    const twoHanded = !!(form && form.hands === 2 && !d.equip.mainStowed);
    const offReady = !!(off && !d.equip.offStowed && !twoHanded);
    const revolverInHand = (offReady && off.kind === 'revolver') || !!(form && form.countsAsRevolver && !d.equip.mainStowed);
    const channelerInHand = offReady && off.kind === 'channeler';
    return { main, mainRef, form, off, offReady, twoHanded, revolverInHand, channelerInHand, mainReady: !!main && !d.equip.mainStowed };
  }

  // ------------------------------------------------------------------
  // Modificadores (classe, talentos, mutações, estados, estágio de Dementia)
  // ------------------------------------------------------------------
  const SET_KEYS = new Set(['limiarBase', 'paRecovery', 'flaskHeal', 'deathDementia', 'counterShotCost', 'coatingRounds', 'paTurnStart', 'unarmedDice', 'unarmedDamage']);
  const MAX_KEYS = new Set(['paMax']);

  function addMods(acc, mods, source) {
    if (!mods) return;
    for (const [k, v] of Object.entries(mods)) {
      if (SET_KEYS.has(k)) { acc[k] = v; continue; }
      if (MAX_KEYS.has(k)) { acc[k] = acc[k] == null ? v : Math.max(acc[k], v); continue; }
      if (typeof v === 'number') { acc[k] = (acc[k] || 0) + v; continue; }
      if (typeof v === 'boolean') { acc[k] = acc[k] || v; continue; }
      if (Array.isArray(v)) { acc[k] = [...(acc[k] || []), ...v]; continue; }
      if (v && typeof v === 'object') {
        acc[k] = acc[k] || {};
        for (const [kk, vv] of Object.entries(v)) {
          if (k === 'defenseBonus') acc[k][kk] = Math.max(acc[k][kk] || 0, vv);
          else acc[k][kk] = (acc[k][kk] || 0) + vv;
        }
      }
    }
    if (source) (acc._sources = acc._sources || []).push(source);
  }

  function modifiers(d, type = 'hunter') {
    const acc = {};
    if (type === 'hunter') {
      addMods(acc, classDef(d).passive?.modifiers, classDef(d).passive?.name);
      for (const t of d.talents || []) addMods(acc, IDX().talents[t]?.modifiers, IDX().talents[t]?.name);
      for (const m of d.mutations || []) addMods(acc, IDX().mutations[m]?.modifiers, IDX().mutations[m]?.name);
      const stage = dementiaStage(d.dementia);
      if (stage?.modifiers) addMods(acc, stage.modifiers, stage.name);
    }
    for (const s of d.states || []) {
      const def = stateDef(s.id);
      if (!def || !def.modifiers) continue;
      const m = { ...def.modifiers };
      if (m.limiarFromValue) { m.limiar = (m.limiar || 0) + (s.value || 1); delete m.limiarFromValue; }
      if (m.diceFromValue) { m.dice = (m.dice || 0) + (s.value || 1); delete m.diceFromValue; }
      addMods(acc, m);
    }
    return acc;
  }

  const dementiaStage = (v) => R().dementia.stages.find(s => v >= s.min && v <= s.max) || R().dementia.stages[0];
  const discernmentStage = (v) => R().discernment.stages.find(s => v >= s.min && v <= s.max) || R().discernment.stages[0];
  const humanitasBand = (v) => R().humanitas.bands.find(b => v >= b.min && v <= b.max) || R().humanitas.bands[2];
  const milestones = (disc) => Math.floor(clamp(disc, 0, R().discernment.max) / R().discernment.milestoneEvery);

  // ------------------------------------------------------------------
  // Valores derivados do caçador
  // ------------------------------------------------------------------
  function derivedHunter(d) {
    const mods = modifiers(d, 'hunter');
    const cls = classDef(d);
    const disc = R().discernment;
    const attrs = {};
    for (const a of R().attributes.attributes) attrs[a.id] = Math.max(0, (d.attributes?.[a.id] || 0) + (mods.attributes?.[a.id] || 0));
    const skills = {};
    for (const s of R().attributes.skills) skills[s.id] = (d.skills?.[s.id] || 0) + (mods.skills?.[s.id] || 0);

    const ms = milestones(d.discernment || 0);
    const hpMilestones = disc.countMilestoneZeroForHp ? ms + 1 : ms;
    const hpMax = cls.hp.base + (d.attributes?.vigor || 0) * cls.hp.vigorMultiplier + hpMilestones * disc.hpPerMilestone + (mods.hpMax || 0);
    const guardMax = cls.guard + (mods.guardMax || 0);

    const h = hands(d);
    const combat = R().combat;
    const paMax = mods.paMax ?? combat.pa.max;
    const paRecovery = Math.max(0, (mods.paRecovery ?? combat.pa.recovery) + (mods.paRecoveryMod || 0));

    // Limiar: base + ação defensiva + forma que defende + estados.
    let limiar = mods.limiarBase ?? combat.limiarBase;
    const breakdown = [`Base ${limiar}`];
    if (d.defense) {
      limiar += d.defense.bonus;
      breakdown.push(`${d.defense.name} +${d.defense.bonus}`);
    }
    if (h.form && h.mainReady && h.form.effects?.limiarBonus) {
      limiar += h.form.effects.limiarBonus;
      breakdown.push(`${h.form.name} +${h.form.effects.limiarBonus}`);
    }
    if (mods.limiar) { limiar += mods.limiar; breakdown.push(`Estados ${mods.limiar > 0 ? '+' : ''}${mods.limiar}`); }

    const reached = (list) => list.filter(m => (d.discernment || 0) >= m).length;
    const spellSlots = cls.spellSlots + reached(disc.extraSpellSlotAt) + (h.off && h.off.kind === 'channeler' ? R().classes.spellSlotsFromChanneler : 0) + (mods.spellSlots || 0);
    const sanityDice = reached(disc.sanityDiceAt) + (mods.sanityDice || 0);

    // Carga
    const carry = R().between.carry;
    const carryMax = carry.base + (d.attributes?.vigor || 0) * carry.perVigor + (mods.carry || 0) + ((d.inventory || []).some(i => i.ref === 'mochila') ? 1 : 0);
    const carryUsed = carryUsage(d);

    const dr = (mods.dr || 0);
    return {
      attributes: attrs,
      skills,
      hpMax, guardMax, paMax, paRecovery,
      limiar, limiarBreakdown: breakdown,
      spellSlots, sanityDice,
      carryMax, carryUsed,
      dr,
      weaknesses: mods.weaknesses || [],
      dementiaStage: dementiaStage(d.dementia || 0),
      discernmentStage: discernmentStage(d.discernment || 0),
      humanitasBand: humanitasBand(d.humanitas || 0),
      milestones: ms,
      hands: { twoHanded: h.twoHanded, revolverInHand: h.revolverInHand, channelerInHand: h.channelerInHand, mainReady: h.mainReady, offReady: h.offReady, form: h.form ? { name: h.form.name, category: h.form.category, hands: h.form.hands } : null },
      rewards: {
        talents: reached(disc.talentsAt),
        attributePoints: reached(disc.attributePointAt),
        skillLevels: reached(disc.skillLevelAt),
        choices: ms + 1
      },
      mods
    };
  }

  function carryUsage(d) {
    const s = R().between.carry.slots;
    let used = 0;
    for (const w of d.weapons || []) used += weaponRef(w)?.slots ?? s.weapon;
    for (const r of d.revolvers || []) used += revolverRef(r)?.slots ?? s.revolver;
    used += (d.channelers || []).length * s.channeler;
    used += Math.ceil((d.flasks || 0) / s.flasksPerSlot);
    for (const it of d.inventory || []) {
      const ref = IDX().items[it.ref];
      if (it.ref === 'mochila' || it.ref === 'pingente-da-oficina') continue;
      if (ref && ref.category === 'material') used += Math.ceil((it.qty || 0) / s.materialsPerSlot);
      else if ((it.qty || 0) > 0) used += 1;
    }
    return used;
  }

  function derivedCreature(d) {
    const mods = modifiers(d, 'creature');
    const tier = R().combat.creatureTiers.find(t => t.id === d.tier) || R().combat.creatureTiers[1];
    let limiar = d.limiar ?? tier.limiar;
    if (mods.limiar) limiar += mods.limiar;
    return {
      limiar,
      limiarBreakdown: [`Base ${d.limiar ?? tier.limiar}`, ...(mods.limiar ? [`Estados ${mods.limiar > 0 ? '+' : ''}${mods.limiar}`] : [])],
      dice: d.dice ?? tier.dice[0],
      hpMax: d.hp?.max ?? null,
      paMax: d.pa?.max ?? tier.pa,
      dr: (d.dr || 0) + (mods.dr || 0),
      tier,
      mods
    };
  }

  function derived(actor) {
    return actor.type === 'hunter' ? derivedHunter(actor.data) : derivedCreature(actor.data);
  }

  // Preenche valores nulos (Vida/Guarda iniciais = máximo).
  function normalize(actor) {
    const d = actor.data;
    if (actor.type === 'hunter') {
      const dv = derivedHunter(d);
      if (d.hp?.value == null) d.hp = { value: dv.hpMax };
      if (d.guard?.value == null) d.guard = { value: dv.guardMax };
    }
    return actor;
  }

  // ------------------------------------------------------------------
  // Visão pública (o que os outros jogadores veem)
  // ------------------------------------------------------------------
  function publicActorData(actor) {
    const d = actor.data || {};
    const states = (d.states || []).map(s => ({ id: s.id, rounds: s.rounds, value: s.value }));
    if (actor.type === 'hunter') {
      const dv = derivedHunter(d);
      return {
        class: d.class,
        hp: { value: d.hp?.value, max: dv.hpMax },
        guard: { value: d.guard?.value, max: dv.guardMax },
        pa: { value: d.pa?.value, max: dv.paMax },
        states, dying: d.dying ? { lit: d.dying.lit, out: d.dying.out } : null
      };
    }
    return {
      tier: d.hideStats || d.unknown ? null : d.tier,
      hp: d.showBars ? { value: d.hp?.value, max: d.hp?.max } : null,
      states,
      unknown: !!(d.unknown || d.hideStats),
      defeated: d.hp?.value != null && d.hp.value <= 0
    };
  }

  // ------------------------------------------------------------------
  // Validação de edições vindas da ficha
  // ------------------------------------------------------------------
  // Campos que só o Mestre altera (administrados pela mesa).
  const GM_ONLY_HUNTER = ['dementia', 'humanitas', 'discernment', 'mutations', 'mutationGrades', 'states', 'dying', 'turn', 'combatFlags', 'paPenalty', 'rest'];

  function sanitizeUpdate(actor, patch, user) {
    const gm = user.role === 'gm';
    const d = actor.data;
    const out = {};
    if (!patch || typeof patch !== 'object') return out;

    if (actor.type === 'creature') {
      if (!gm) return out;
      const allowed = ['tier', 'limiar', 'dice', 'hp', 'pa', 'ecos', 'weaknesses', 'resistances', 'dr', 'attacks', 'abilities', 'phases', 'phase', 'hideStats', 'unknown', 'noOpportunity', 'maxAttacksPerTurn', 'showBars', 'notes', 'category', 'tokenSize', 'quote', 'text', 'states'];
      for (const k of allowed) if (patch[k] !== undefined) out[k] = patch[k];
      if (out.limiar !== undefined && out.limiar !== null) out.limiar = int(out.limiar, 2);
      if (out.dice !== undefined && out.dice !== null) out.dice = clamp(int(out.dice, 7), 0, 60);
      if (out.hp) out.hp = { value: out.hp.value == null ? d.hp?.value : int(out.hp.value), max: out.hp.max == null ? d.hp?.max : int(out.hp.max) };
      if (out.pa) out.pa = { value: out.pa.value == null ? d.pa?.value : int(out.pa.value), max: out.pa.max == null ? d.pa?.max : int(out.pa.max) };
      return out;
    }

    const attrs = R().attributes;
    for (const [k, v] of Object.entries(patch)) {
      if (!gm && GM_ONLY_HUNTER.includes(k)) continue;
      switch (k) {
        case 'class':
          if (R().classes.classes.some(c => c.id === v)) out.class = v;
          break;
        case 'classSkill': {
          const cls = R().classes.classes.find(c => c.id === (patch.class || d.class));
          if (cls && cls.classSkills.includes(v)) out.classSkill = v;
          break;
        }
        case 'attributes': {
          const max = attrs.creation.attributeMaxAfterCreation;
          out.attributes = {};
          for (const a of attrs.attributes) if (v[a.id] !== undefined) out.attributes[a.id] = clamp(int(v[a.id], 1), 0, gm ? 20 : max);
          break;
        }
        case 'skills': {
          out.skills = {};
          for (const s of attrs.skills) if (v[s.id] !== undefined) out.skills[s.id] = clamp(int(v[s.id], 0), 0, gm ? 10 : attrs.proficiency.max);
          break;
        }
        case 'hp': out.hp = { value: int(v.value, d.hp?.value) }; break;
        case 'guard': out.guard = { value: int(v.value, d.guard?.value) }; break;
        case 'pa': if (gm) out.pa = { value: clamp(int(v.value, 0), 0, 30) }; break;
        case 'flasks': out.flasks = clamp(int(v, 0), 0, 99); break;
        case 'ecos': out.ecos = clamp(int(v, 0), 0, 9999999); break;
        case 'dementia': out.dementia = clamp(int(v, 0), R().dementia.min, R().dementia.max); break;
        case 'humanitas': out.humanitas = clamp(int(v, 0), R().humanitas.min, R().humanitas.max); break;
        case 'discernment': out.discernment = clamp(int(v, 0), R().discernment.min, R().discernment.max); break;
        case 'talents':
          if (Array.isArray(v)) out.talents = [...new Set(v.filter(t => IDX().talents[t]))];
          break;
        case 'mutations':
          if (Array.isArray(v)) out.mutations = [...new Set(v.filter(t => IDX().mutations[t]))];
          break;
        case 'mutationGrades':
          if (Array.isArray(v)) out.mutationGrades = v.map(String);
          break;
        case 'marks':
          if (Array.isArray(v)) out.marks = [...new Set(v.filter(t => IDX().marks[t] && (gm || IDX().marks[t].discernment <= (d.discernment || 0))))];
          break;
        case 'arcana': {
          const cls = classDef({ ...d, ...out });
          const known = Array.isArray(v.known) ? [...new Set(v.known.filter(a => {
            const ar = IDX().arcana[a];
            if (!ar) return false;
            if (gm) return true;
            return cls.academies.includes(ar.academy) && ar.discernment <= (d.discernment || 0);
          }))] : d.arcana.known;
          out.arcana = { known };
          if (Array.isArray(v.prepared)) out.arcana.prepared = [...new Set(v.prepared.filter(a => known.includes(a)))];
          if (gm && v.cooldowns) out.arcana.cooldowns = v.cooldowns;
          break;
        }
        case 'weapons':
          if (Array.isArray(v)) out.weapons = v.filter(w => IDX().weapons[w.ref]).map(w => ({
            uid: w.uid || uid(), ref: w.ref, form: w.form === 'truque' ? 'truque' : 'padrao',
            reforco: clamp(int(w.reforco, 0), 0, gm ? 10 : 3), coating: gm ? (w.coating || null) : (d.weapons.find(x => x.uid === w.uid)?.coating || null),
            charged: !!w.charged, ...(w.ammo !== undefined ? { ammo: clamp(int(w.ammo, 0), 0, 12) } : {})
          }));
          break;
        case 'revolvers':
          if (Array.isArray(v)) out.revolvers = v.filter(r => IDX().revolvers[r.ref]).map(r => ({ uid: r.uid || uid(), ref: r.ref, ammo: clamp(int(r.ammo, 0), 0, 12) }));
          break;
        case 'channelers':
          if (Array.isArray(v)) out.channelers = v.filter(c => IDX().channelers[c.ref]).map(c => ({ uid: c.uid || uid(), ref: c.ref, afinacao: clamp(int(c.afinacao, 0), 0, gm ? 10 : 3) }));
          break;
        case 'equip':
          out.equip = { main: v.main ?? d.equip.main, off: v.off ?? d.equip.off, offStowed: !!(v.offStowed ?? d.equip.offStowed), mainStowed: !!(v.mainStowed ?? d.equip.mainStowed) };
          break;
        case 'inventory':
          if (Array.isArray(v)) out.inventory = v.slice(0, 200).map(i => ({
            uid: i.uid || uid(), ref: i.ref && IDX().items[i.ref] ? i.ref : null,
            name: String(i.name || (i.ref && IDX().items[i.ref]?.name) || 'Item').slice(0, 80), qty: clamp(int(i.qty, 1), 0, 9999)
          }));
          break;
        case 'notes': case 'biography': case 'appearance':
          out[k] = String(v).slice(0, 20000);
          break;
        case 'tokenSize':
          out.tokenSize = clamp(Number(v) || 1, 0.5, 4);
          break;
        case 'states': case 'dying': case 'turn': case 'combatFlags': case 'rest':
          if (gm) out[k] = v;
          break;
        case 'paPenalty':
          if (gm) out.paPenalty = clamp(int(v, 0), 0, 20);
          break;
        default: break;
      }
    }
    return out;
  }

  return {
    uid, clamp, int,
    defaultActorData, defaultHunter, defaultCreature, creatureFromCompendium,
    newWeapon, newRevolver, newChanneler,
    weaponRef, revolverRef, channelerRef, stateDef, classDef, findItem, hands,
    modifiers, derived, derivedHunter, derivedCreature, normalize,
    dementiaStage, discernmentStage, humanitasBand, milestones,
    publicActorData, sanitizeUpdate
  };
}

module.exports = { createModel };
