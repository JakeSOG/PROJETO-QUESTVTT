// Reprodutor de áudio sincronizado: tocam as faixas que o Mestre ligou, com volume individual.
import { state, on } from './state.js';

const players = new Map(); // trackId → HTMLAudioElement
let master = Number(localStorage.getItem('qvtt.volume') ?? 0.8);
let clockOffset = 0; // diferença entre relógio do servidor e local

export function setMasterVolume(v) {
  master = Math.max(0, Math.min(1, v));
  try { localStorage.setItem('qvtt.volume', String(master)); } catch { /* ok */ }
  for (const [id, a] of players) a.volume = (a.trackVolume ?? 0.8) * master;
}
export const getMasterVolume = () => master;

export function initAudio() {
  const unlock = document.getElementById('audioUnlock');
  const tryPlay = (a) => a.play().catch(() => unlock.classList.remove('hidden'));
  unlock.addEventListener('click', () => {
    unlock.classList.add('hidden');
    for (const a of players.values()) a.play().catch(() => {});
  });

  function sync() {
    const st = state.audio;
    const playing = st?.playing || {};
    if (st?.serverNow) clockOffset = st.serverNow - Date.now();
    for (const [id, a] of players) {
      if (!playing[id]) { a.pause(); a.src = ''; players.delete(id); }
    }
    for (const [id, tr] of Object.entries(playing)) {
      let a = players.get(id);
      if (!a) {
        a = new Audio(tr.url);
        a.loop = !!tr.loop;
        a.preload = 'auto';
        a.addEventListener('loadedmetadata', () => {
          const elapsed = (Date.now() + clockOffset - tr.startedAt) / 1000;
          if (a.duration && isFinite(a.duration)) a.currentTime = tr.loop ? elapsed % a.duration : Math.min(elapsed, a.duration);
        }, { once: true });
        players.set(id, a);
        tryPlay(a);
      }
      a.trackVolume = tr.volume ?? 0.8;
      a.volume = a.trackVolume * master;
    }
  }
  on('audio', sync);
  on('world:reset', sync);
  on('sfx', (s) => { const a = new Audio(s.url); a.volume = (s.volume ?? 0.8) * master; a.play().catch(() => {}); });
}
