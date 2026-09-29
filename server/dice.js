// Rolagens genéricas de dados (núcleo do VTT). Toda rolagem acontece no SERVIDOR.
const crypto = require('crypto');

// Gerador substituível apenas em testes automatizados (nunca em jogo).
let testRng = null;
function setTestRng(fn) { testRng = fn; }

// Inteiro aleatório uniforme em [1, sides] usando gerador criptográfico.
function rollDie(sides) {
  if (testRng) return Math.max(1, Math.min(sides, testRng(sides)));
  return crypto.randomInt(1, sides + 1);
}

// Interpreta expressões como "2d6+1d4+3", "1d8-1", "4d6". Retorna null se inválida.
function parseFormula(formula) {
  const clean = String(formula || '').replace(/\s+/g, '').toLowerCase();
  if (!clean || clean.length > 60) return null;
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(clean)) return null;
  const terms = [];
  const re = /([+-]?)(\d*d\d+|\d+)/g;
  let m;
  while ((m = re.exec(clean))) {
    const sign = m[1] === '-' ? -1 : 1;
    if (m[2].includes('d')) {
      const [n, s] = m[2].split('d');
      const count = n === '' ? 1 : Number(n);
      const sides = Number(s);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      terms.push({ sign, count, sides });
    } else {
      terms.push({ sign, value: Number(m[2]) });
    }
  }
  return terms;
}

// Rola uma fórmula e devolve { total, parts: [{sides, results[]} | {value}] }.
function rollFormula(formula) {
  const terms = parseFormula(formula);
  if (!terms) return null;
  let total = 0;
  const parts = [];
  for (const t of terms) {
    if (t.sides) {
      const results = Array.from({ length: t.count }, () => rollDie(t.sides));
      const sum = results.reduce((a, b) => a + b, 0) * t.sign;
      total += sum;
      parts.push({ sign: t.sign, sides: t.sides, results });
    } else {
      total += t.value * t.sign;
      parts.push({ sign: t.sign, value: t.value });
    }
  }
  return { formula: String(formula).replace(/\s+/g, ''), total, parts };
}

module.exports = { rollDie, parseFormula, rollFormula, setTestRng };
