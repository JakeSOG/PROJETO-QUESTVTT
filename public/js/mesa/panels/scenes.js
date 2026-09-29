// Cenas (Mestre): criar, configurar grade/visão, ativar para todos, espiar, exportar/importar.
import { state, on } from '../state.js';
import { call, upload } from '../net.js';
import { h, formDialog, confirmDialog, pickFile, downloadJSON, readJSONFile, toast } from '../ui.js';

export function scenesPanel(app, panel) {
  const head = h('div.panel-head', h('h3', 'Cenas'),
    h('button.small', { onclick: createScene }, '+ Nova'),
    h('button.small', { onclick: importScene }, 'Importar'));
  const body = h('div.panel-body');
  panel.append(head, body);

  async function createScene() {
    const r = await formDialog('Nova cena', [
      { name: 'name', label: 'Nome', value: 'Nova cena' },
      { name: 'withMap', label: 'Enviar imagem do mapa agora', type: 'checkbox', value: true }
    ]);
    if (!r) return;
    let data = {};
    if (r.withMap) {
      const bg = await chooseMap();
      if (bg) data = bg;
    }
    const res = await call('scene:create', { name: r.name, data });
    if (res.scene) { call('scene:view', { id: res.scene.id }); configure(res.scene); }
  }

  // Envia a imagem e descobre as dimensões para ajustar a cena.
  async function chooseMap() {
    const file = await pickFile('image/png,image/jpeg,image/webp,image/gif');
    if (!file) return null;
    toast('Enviando mapa…');
    const url = await upload('map', file);
    if (!url) return null;
    const dims = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => resolve(null); i.src = url; });
    return { background: url, ...(dims ? { width: dims.w, height: dims.h } : {}) };
  }

  async function configure(scene) {
    const d = scene.data, g = d.grid;
    const r = await formDialog(`Configurar: ${scene.name}`, [
      { name: 'name', label: 'Nome', value: scene.name },
      { name: 'width', label: 'Largura (px)', type: 'number', value: d.width },
      { name: 'height', label: 'Altura (px)', type: 'number', value: d.height },
      { name: 'bgColor', label: 'Cor de fundo', type: 'color', value: d.bgColor || '#0b0908' },
      { name: 'size', label: 'Tamanho do quadrado (px)', type: 'number', value: g.size },
      { name: 'offsetX', label: 'Deslocamento X da grade', type: 'number', value: g.offsetX },
      { name: 'offsetY', label: 'Deslocamento Y da grade', type: 'number', value: g.offsetY },
      { name: 'units', label: 'Metros por quadrado', type: 'number', value: g.units, step: 0.5 },
      { name: 'show', label: 'Mostrar grade', type: 'checkbox', value: g.show },
      { name: 'gridColor', label: 'Cor da grade', type: 'color', value: g.color },
      { name: 'alpha', label: 'Opacidade da grade (0–1)', type: 'number', value: g.alpha, step: 0.05 },
      { name: 'vision', label: 'Visão e luz (escuridão padrão)', type: 'checkbox', value: d.vision },
      { name: 'darkness', label: 'Escuridão para jogadores (0–1)', type: 'number', value: d.darkness, step: 0.05 },
      { name: 'gmDarkness', label: 'Escuridão vista pelo Mestre (0–1)', type: 'number', value: d.gmDarkness, step: 0.05 },
      { name: 'fog', label: 'Névoa de guerra', type: 'checkbox', value: d.fog }
    ], { width: 480, intro: 'Dica: para alinhar a grade ao desenho do mapa, ajuste o tamanho do quadrado e os deslocamentos.' });
    if (!r) return;
    call('scene:update', { id: scene.id, name: r.name, data: {
      width: r.width, height: r.height, bgColor: r.bgColor, vision: r.vision, darkness: r.darkness, gmDarkness: r.gmDarkness, fog: r.fog,
      grid: { size: r.size, offsetX: r.offsetX, offsetY: r.offsetY, units: r.units, show: r.show, color: r.gridColor, alpha: r.alpha }
    } });
  }

  async function importScene() {
    const json = await readJSONFile();
    if (json) { const res = await call('scene:import', { json }); if (res.scene) toast('Cena importada.', 'ok'); }
  }

  function render() {
    const viewing = state.scene?.scene.id;
    body.replaceChildren(...state.scenes.map(s => {
      const el = h('div.list-item', { class: `list-item ${s.id === viewing ? 'active' : ''}` },
        h('div.thumb', s.data.background ? h('img', { src: s.data.background, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '3px' } }) : '🗺'),
        h('div.grow', h('div.name', s.name), h('div.small.muted', s.active ? '● ativa para todos' : s.id === viewing ? 'você está vendo' : '')));
      el.addEventListener('click', () => call('scene:view', { id: s.id }));
      const menu = h('div.row', { style: { gap: '2px' } },
        !s.active ? h('button.small', { title: 'Levar todos para esta cena', onclick: (e) => { e.stopPropagation(); call('scene:activate', { id: s.id }); } }, 'Ativar') : null,
        h('button.small.ghost', { title: 'Configurar', onclick: (e) => { e.stopPropagation(); configure(s); } }, '⚙'),
        h('button.small.ghost', { title: 'Trocar imagem do mapa', onclick: async (e) => { e.stopPropagation(); const bg = await chooseMap(); if (bg) call('scene:update', { id: s.id, data: bg }); } }, '🖼'),
        h('button.small.ghost', { title: 'Exportar JSON', onclick: async (e) => { e.stopPropagation(); const r = await call('scene:export', { id: s.id }); if (r.export) downloadJSON(`cena-${s.name}.json`, r.export); } }, '⤓'),
        h('button.small.ghost', { title: 'Apagar', onclick: async (e) => { e.stopPropagation(); if (await confirmDialog('Apagar cena', `Apagar <b>${s.name}</b> com todos os tokens, paredes e luzes?`, { danger: true, okLabel: 'Apagar' })) call('scene:delete', { id: s.id }); } }, '🗑'));
      el.append(menu);
      return el;
    }));
    if (!state.scenes.length) body.append(h('p.muted', 'Crie a primeira cena: envie a imagem do mapa e ajuste a grade.'));
  }

  on('scenes', render);
  on('scene', render);
  on('world:reset', render);
}
