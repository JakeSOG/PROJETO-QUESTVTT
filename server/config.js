// Carrega e valida o config.json da raiz do projeto.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = process.env.QUESTVTT_CONFIG || path.join(ROOT, 'config.json');

const DEFAULTS = {
  port: 3000,
  tableName: 'QuestVTT',
  system: 'duskbloods',
  gmName: 'Mestre',
  gmPassword: 'trocar-esta-senha',
  tablePassword: '',
  autoApprovePlayers: false,
  allowSpectators: true,
  uploadMaxMB: 25,
  backupKeep: 20,
  backupEveryMinutes: 30,
  chatHistory: 200
};

function loadConfig() {
  let fileCfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      console.error(`✖ config.json inválido: ${err.message}`);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
    console.log('✦ config.json criado com valores padrão.');
  }
  const cfg = { ...DEFAULTS, ...fileCfg };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  // Pasta de dados pode ser trocada por variável de ambiente (útil em testes).
  cfg.dataDir = process.env.QUESTVTT_DATA || path.join(ROOT, 'data');
  cfg.root = ROOT;
  return cfg;
}

module.exports = { loadConfig, ROOT };
