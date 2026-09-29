// Handouts: imagem/texto em tela cheia enviados pelo Mestre.
import { state, on, isGM } from './state.js';
import { call } from './net.js';
import { h } from './ui.js';

export function initHandout() {
  const el = document.getElementById('handout');
  const render = () => {
    const ho = state.handout;
    if (!ho) { el.classList.add('hidden'); el.replaceChildren(); return; }
    el.classList.remove('hidden');
    el.replaceChildren(h('div.handout-inner.frame',
      ho.title ? h('h2', ho.title) : null,
      ho.img ? h('img', { src: ho.img, alt: ho.title || 'Handout' }) : null,
      ho.text ? h('div.text', ho.text) : null,
      h('div.row', { style: { justifyContent: 'center', marginTop: '14px' } },
        isGM() ? h('button.primary', { onclick: () => call('handout:close') }, 'Fechar para todos') : null,
        h('button', { onclick: () => el.classList.add('hidden') }, 'Esconder'))));
  };
  on('handout', render);
  on('world:reset', render);
}
