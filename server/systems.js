// Carregador de SISTEMAS de jogo (como os "systems" do Foundry VTT).
// Cada sistema vive em /systems/<id>/ com:
//   system.json        → metadados
//   rules/*.json       → regras (editáveis pelo Mestre)
//   compendium/*.json  → armas, arcanos, bestiário...
//   server/engine.js   → motor que LÊ e APLICA as regras
//   client/index.js    → ficha e diálogos no navegador
const path = require('path');
const fs = require('fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadSystem(root, id) {
  const dir = path.join(root, 'systems', id);
  if (!fs.existsSync(path.join(dir, 'system.json'))) {
    throw new Error(`Sistema "${id}" não encontrado em ${dir}`);
  }
  const system = { id, dir, manifest: null, rules: {}, compendium: {}, errors: [] };

  function load() {
    const errors = [];
    const manifest = readJson(path.join(dir, 'system.json'));
    const rules = {};
    for (const name of manifest.rules || []) {
      const file = path.join(dir, 'rules', `${name}.json`);
      try { rules[name] = readJson(file); } catch (err) { errors.push(`rules/${name}.json: ${err.message}`); }
    }
    const compendium = {};
    for (const [name, label] of Object.entries(manifest.compendium || {})) {
      const file = path.join(dir, 'compendium', `${name}.json`);
      try {
        const json = readJson(file);
        compendium[name] = { label, entries: json.entries || [], meta: json };
      } catch (err) { errors.push(`compendium/${name}.json: ${err.message}`); }
    }
    // Só troca as regras se tudo carregou sem erro (evita derrubar a mesa com um JSON quebrado).
    if (errors.length && system.manifest) return { ok: false, errors };
    system.manifest = manifest;
    system.rules = rules;
    system.compendium = compendium;
    system.errors = errors;
    // Índices por id para consultas rápidas no motor.
    system.index = {};
    for (const [name, pack] of Object.entries(compendium)) {
      system.index[name] = Object.fromEntries(pack.entries.map(e => [e.id, e]));
    }
    return { ok: errors.length === 0, errors };
  }

  const first = load();
  if (first.errors.length) console.warn('⚠ Erros ao carregar regras:\n  ' + first.errors.join('\n  '));

  // Pacote enviado ao navegador (regras + compêndio completos).
  system.clientPayload = () => ({
    id: system.id,
    manifest: system.manifest,
    rules: system.rules,
    compendium: system.compendium
  });

  system.reload = load;

  // Recarrega automaticamente quando um JSON muda (debounce de 400 ms).
  system.watch = (onReload) => {
    let t = null;
    const trigger = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const res = load();
        onReload(res);
      }, 400);
    };
    for (const sub of ['rules', 'compendium']) {
      try { fs.watch(path.join(dir, sub), trigger); } catch { /* sem suporte a watch */ }
    }
  };

  const enginePath = path.join(dir, 'server', 'engine.js');
  system.createEngine = fs.existsSync(enginePath) ? require(enginePath).createEngine : null;
  return system;
}

module.exports = { loadSystem };
