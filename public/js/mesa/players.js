// Lista de jogadores online (canto inferior esquerdo), com a cor de cada um.
import { state, on } from './state.js';
import { h } from './ui.js';

export function initPlayers() {
  const el = document.getElementById('players');
  const render = () => {
    const users = [...state.users].filter(u => u.status === undefined || u.status === 'approved')
      .sort((a, b) => (b.online - a.online) || (a.role === 'gm' ? -1 : 1));
    el.replaceChildren(h('h4', 'NA MESA'), ...users.map(u => h('div.player-line', { class: `player-line ${u.online ? '' : 'offline'}` },
      h('span.player-dot', { style: { background: u.color, color: u.color } }),
      h('span', u.name, u.role === 'gm' ? ' (Mestre)' : u.role === 'spectator' ? ' (espectador)' : '', u.id === state.user.id ? ' — você' : ''))));
  };
  on('users', render);
  on('world:reset', render);
}
