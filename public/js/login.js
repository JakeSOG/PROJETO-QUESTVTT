// Tela de entrada: login de Mestre/jogador/espectador e espera de aprovação.
const $ = (id) => document.getElementById(id);

async function me() {
  const res = await fetch('/api/me', { credentials: 'same-origin' });
  return res.json();
}

function showPending() {
  $('loginForm').classList.add('hidden');
  $('pendingBox').classList.remove('hidden');
  // Aguarda aprovação: o servidor avisa pelo socket.
  const s = window.io ? window.io() : null;
  if (s) {
    s.on('auth:approved', () => location.href = '/mesa');
  }
  setInterval(async () => {
    const info = await me();
    if (info.user && info.user.status === 'approved') location.href = '/mesa';
  }, 4000);
}

async function init() {
  const info = await me();
  $('tableName').textContent = info.tableName || '';
  document.title = `${info.tableName || 'QuestVTT'} — Entrada`;
  if (info.needsTablePassword) $('tablePwRow').classList.remove('hidden');
  // Dica para o Mestre (o nome dele vem do config.json).
  $('gmHint').textContent = `É o Mestre? Entre com o nome "${info.gmName}" e a senha do Mestre (gmPassword no config.json).`;
  $('pendingGmHint').textContent = `É o Mestre? Clique em Sair e entre com o nome "${info.gmName}".`;
  if (!info.allowSpectators) $('spectatorRow').classList.add('hidden');
  if (info.user) {
    if (info.user.status === 'approved') { location.href = '/mesa'; return; }
    if (info.user.status === 'pending') showPending();
  }
  const saved = localStorage.getItem('qvtt.name');
  if (saved) { $('name').value = saved; $('password').focus(); }
  $('name').addEventListener('input', () => {
    const isGM = $('name').value.trim().toLowerCase() === String(info.gmName || '').toLowerCase();
    $('pwHint').textContent = isGM ? '(senha do Mestre)' : '(crie uma na primeira vez)';
    $('tablePwRow').classList.toggle('hidden', isGM || !info.needsTablePassword);
  });
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('error').textContent = '';
  const body = {
    name: $('name').value.trim(),
    password: $('password').value,
    tablePassword: $('tablePassword').value,
    spectator: $('spectator').checked
  };
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) { $('error').textContent = data.error || 'Falha ao entrar.'; return; }
    try { localStorage.setItem('qvtt.name', body.name); } catch { /* sem armazenamento */ }
    if (data.user.status === 'approved') location.href = '/mesa';
    else showPending();
  } catch {
    $('error').textContent = 'Servidor inacessível. Verifique o endereço e a rede.';
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

// Socket.IO só é carregado quando necessário (aprovação).
const sio = document.createElement('script');
sio.src = '/socket.io/socket.io.js';
document.head.appendChild(sio);

init();
