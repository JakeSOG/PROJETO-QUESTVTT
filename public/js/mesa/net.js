// Comunicação com o servidor (Socket.IO + HTTP).
import { toast } from './ui.js';

export const socket = window.io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelayMax: 4000, autoConnect: false });

// Envia um evento e espera a resposta (ack). Mostra o erro como aviso.
export function call(event, payload = {}, { silent = false } = {}) {
  return new Promise((resolve) => {
    socket.timeout(20000).emit(event, payload, (err, res) => {
      if (err) { if (!silent) toast('O servidor não respondeu a tempo.', 'error'); return resolve({ error: 'timeout' }); }
      if (res && res.error && !silent) toast(res.error, 'error');
      resolve(res || {});
    });
  });
}

// Upload de arquivo (mapas, tokens, retratos, áudio, handouts).
export async function upload(kind, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/upload/${kind}`, { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({ error: 'Resposta inválida.' }));
  if (!res.ok) { toast(data.error || 'Falha no upload.', 'error'); return null; }
  return data.url;
}

export async function getJSON(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
