// Pool de D6 do DuskBloods: conta sucessos, explode 6, detecta Falha Crítica.
// Todos os números vêm de rules/core.json.
const { rollDie, rollFormula } = require('../../../server/dice');

// Rola `count` dados. Cada dado vira uma "cadeia": [primeiro, explosões...].
function rollPool(count, core) {
  const d = core.dice;
  const n = Math.max(0, Math.min(60, Math.floor(count)));
  const chains = [];
  let successes = 0;
  for (let i = 0; i < n; i++) {
    const chain = [rollDie(d.sides)];
    let guard = 0;
    while (d.explode && chain[chain.length - 1] >= d.explodeOn && guard < d.maxExplosionsPerDie) {
      chain.push(rollDie(d.sides));
      guard++;
    }
    for (const v of chain) if (v >= d.successMin) successes++;
    chains.push(chain);
  }

  // Falha Crítica: nenhum sucesso → rola de novo os 1; cada novo 1 é uma falha adicional.
  let critFail = null;
  const cf = core.criticalFailure;
  if (n > 0 && (!cf.requireZeroSuccesses || successes === 0)) {
    const ones = chains.filter(c => c[0] === cf.rerollFace).length;
    if (ones > 0) {
      const rerolls = Array.from({ length: ones }, () => rollDie(d.sides));
      const newOnes = rerolls.filter(v => v === cf.rerollFace).length;
      const isCrit = cf.requireNewOne ? newOnes > 0 : true;
      critFail = { rerolls, newOnes, isCrit, severity: isCrit ? Math.max(1, newOnes) : 0 };
    }
  }
  return { count: n, chains, successes, critFail };
}

// Compara com uma dificuldade/Limiar e calcula excedentes e crítico.
function evaluate(pool, target, core) {
  const passed = pool.successes >= target;
  const excess = passed ? pool.successes - target : 0;
  return {
    target,
    passed,
    excess,
    critical: passed && excess >= core.criticalSuccessExcess,
    criticalFailure: !passed && !!(pool.critFail && pool.critFail.isCrit)
  };
}

// Rola uma lista de partes de dano [{dice:'1d6', type}] → [{type, amount, formula, results}].
function rollParts(parts) {
  return (parts || []).map(p => {
    const r = rollFormula(p.dice);
    return { type: p.type, amount: r ? Math.max(0, r.total) : 0, formula: p.dice, roll: r };
  });
}

module.exports = { rollPool, evaluate, rollParts, rollFormula };
