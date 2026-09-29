// Fichas: caçadores dos jogadores e criaturas do Mestre. Arraste para o mapa.
import { state, on, isGM, canControl, userById } from '../state.js';
import { call } from '../net.js';
import { h, formDialog, readJSONFile, toast } from '../ui.js';

export function actorsPanel(app, panel) {
  const search = h('input', { type: 'search', placeholder: 'Buscar…', style: { flex: 1 } });
  const head = h('div.panel-head', search);
  const body = h('div.panel-body');
  panel.append(head, body);
  search.addEventListener('input', render);

  function actions() {
    const row = h('div.row', { style: { marginBottom: '8px' } });
    const types = state.system.manifest.actorTypes;
    if (isGM()) {
      for (const [type, label] of Object.entries(types)) row.append(h('button.small', { onclick: () => createActor(type) }, `+ ${label}`));
      row.append(h('button.small', { onclick: importActor }, 'Importar JSON'));
    } else if (state.user.role === 'player' && ![...state.actors.values()].some(a => a.owner_id === state.user.id)) {
      row.append(h('button.small.primary', { onclick: () => createActor(state.system.manifest.playerActorType) }, `+ Criar meu ${types[state.system.manifest.playerActorType]}`));
    }
    return row;
  }

  async function createActor(type) {
    if (app.system?.createActorDialog) return app.system.createActorDialog(type);
    const r = await formDialog('Nova ficha', [{ name: 'name', label: 'Nome', value: '' }]);
    if (r) call('actor:create', { type, name: r.name });
  }

  async function importActor() {
    const json = await readJSONFile();
    if (!json) return;
    const res = await call('actor:import', { json });
    if (res.actor) toast(`Ficha "${res.actor.name}" importada.`, 'ok');
  }

  function item(a) {
    const owner = a.owner_id ? userById(a.owner_id) : null;
    const el = h('div.list-item', { draggable: canControl(a) || isGM() ? 'true' : 'false', title: 'Clique para abrir. Arraste para o mapa.' },
      a.img ? h('img.thumb', { src: a.img, alt: '' }) : h('div.thumb', a.name.slice(0, 2).toUpperCase()),
      h('div.grow',
        h('div.name', a.name),
        h('div.small.muted', app.system?.actorSubtitle ? app.system.actorSubtitle(a) : a.type, owner ? ` · ${owner.name}` : '')));
    el.addEventListener('click', () => app.system?.openSheet?.(a));
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-questvtt', JSON.stringify({ type: 'actor', id: a.id }));
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'actor', id: a.id }));
    });
    return el;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = [...state.actors.values()].filter(a => !q || a.name.toLowerCase().includes(q));
    const groups = {};
    for (const a of list) {
      const key = a.type === state.system.manifest.playerActorType ? a.type : (a.data?.sceneCopy ? 'scene' : a.type);
      (groups[key] = groups[key] || []).push(a);
    }
    body.replaceChildren(actions());
    const labels = { ...state.system.manifest.actorTypes, scene: 'Criaturas no mapa' };
    for (const key of [state.system.manifest.playerActorType, ...Object.keys(labels).filter(k => k !== state.system.manifest.playerActorType)]) {
      const g = groups[key];
      if (!g || !g.length) continue;
      if (key === 'scene' && !isGM()) continue;
      body.append(h('div.group-title', labels[key] || key));
      for (const a of g.sort((x, y) => x.name.localeCompare(y.name))) body.append(item(a));
    }
    if (!list.length) body.append(h('p.muted', isGM() ? 'Nenhuma ficha ainda.' : 'Nenhuma ficha visível. Peça ao Mestre para vincular a sua.'));
  }

  on('actors', render);
  on('users', render);
  on('world:reset', render);
  on('system', render);
}
