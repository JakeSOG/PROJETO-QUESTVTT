// Barra lateral com abas (como o Foundry): Chat, Combate, Fichas, Cenas, Compêndio, Diário, Áudio, Tabelas, Configurações.
import { state, isGM, on } from './state.js';
import { h } from './ui.js';
import { chatPanel } from './panels/chat.js';
import { combatPanel } from './panels/combat.js';
import { actorsPanel } from './panels/actors.js';
import { scenesPanel } from './panels/scenes.js';
import { compendiumPanel } from './panels/compendium.js';
import { journalPanel } from './panels/journal.js';
import { audioPanel } from './panels/audio.js';
import { tablesPanel } from './panels/tables.js';
import { settingsPanel } from './panels/settings.js';

export function initSidebar(app) {
  const tabs = [
    { id: 'chat', icon: '💬', title: 'Chat e rolagens', make: chatPanel },
    { id: 'combat', icon: '⚔', title: 'Combate', make: combatPanel },
    { id: 'actors', icon: '👤', title: 'Fichas', make: actorsPanel },
    { id: 'scenes', icon: '🗺', title: 'Cenas', make: scenesPanel, gm: true },
    { id: 'compendium', icon: '📖', title: 'Compêndio', make: compendiumPanel },
    { id: 'journal', icon: '📜', title: 'Diário', make: journalPanel },
    { id: 'audio', icon: '🎵', title: 'Música e ambiente', make: audioPanel },
    { id: 'tables', icon: '🎲', title: 'Tabelas aleatórias', make: tablesPanel },
    { id: 'settings', icon: '⚙', title: 'Jogadores e configurações', make: settingsPanel }
  ].filter(t => !t.gm || isGM());

  const tabsEl = document.getElementById('tabs');
  const panelsEl = document.getElementById('panels');
  const buttons = {};
  const panels = {};
  let current = localStorage.getItem('qvtt.tab') || 'chat';
  if (!tabs.some(t => t.id === current)) current = 'chat';

  for (const t of tabs) {
    const panel = h('section.panel', { id: `panel-${t.id}` });
    panelsEl.append(panel);
    panels[t.id] = panel;
    buttons[t.id] = h('button', { title: t.title, onclick: () => show(t.id) }, t.icon);
    tabsEl.append(buttons[t.id]);
    t.make(app, panel, { badge: (n) => setBadge(t.id, n) });
  }

  function setBadge(id, n) {
    const b = buttons[id];
    if (!b) return;
    b.querySelector('.count')?.remove();
    if (n && current !== id) b.append(h('span.count', String(n)));
  }

  function show(id) {
    current = id;
    try { localStorage.setItem('qvtt.tab', id); } catch { /* ok */ }
    for (const t of tabs) {
      buttons[t.id].classList.toggle('active', t.id === id);
      panels[t.id].classList.toggle('active', t.id === id);
    }
    buttons[id].querySelector('.count')?.remove();
    app.emit?.('tab', id);
  }
  app.showTab = show;
  show(current);

  const toggle = document.getElementById('sidebarToggle');
  toggle.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    toggle.textContent = document.body.classList.contains('sidebar-collapsed') ? '⟨' : '⟩';
    window.dispatchEvent(new Event('resize'));
  });
  if (window.innerWidth < 900) toggle.click();
  on('world:reset', () => {});
}
