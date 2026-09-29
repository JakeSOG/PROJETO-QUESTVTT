// Detecta os endereços IPv4 da máquina para mostrar aos jogadores (LAN e Radmin VPN).
const os = require('os');

function listAddresses() {
  const result = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const addr of list || []) {
      if (addr.family !== 'IPv4' && addr.family !== 4) continue;
      if (addr.internal) continue;
      // Radmin VPN usa a faixa 26.x.x.x
      const kind = addr.address.startsWith('26.') ? 'radmin'
        : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr.address) ? 'lan'
        : addr.address.startsWith('25.') ? 'hamachi' : 'outro';
      result.push({ name, address: addr.address, kind });
    }
  }
  return result;
}

function printBanner(port, tableName) {
  const addrs = listAddresses();
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log(`  ✦ QuestVTT rodando — mesa "${tableName}"`);
  console.log(line);
  console.log(`  Local:      http://localhost:${port}`);
  for (const a of addrs) {
    if (a.kind === 'lan') console.log(`  Rede local: http://${a.address}:${port}`);
  }
  for (const a of addrs) {
    if (a.kind === 'radmin') console.log(`  Radmin VPN: http://${a.address}:${port}   ← passe este para os jogadores`);
    if (a.kind === 'hamachi') console.log(`  Hamachi:    http://${a.address}:${port}`);
    if (a.kind === 'outro') console.log(`  Outro:      http://${a.address}:${port}  (${a.name})`);
  }
  if (!addrs.some(a => a.kind === 'radmin')) {
    console.log('  (Radmin VPN não detectado — abra o Radmin e entre na sua rede.)');
  }
  console.log(`${line}\n  Para encerrar: feche esta janela ou aperte Ctrl+C.\n`);
}

module.exports = { listAddresses, printBanner };
