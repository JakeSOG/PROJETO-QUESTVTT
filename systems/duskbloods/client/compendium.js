// Compêndio do DuskBloods: resumo de cada entrada e "adicionar à ficha".
import { ctx, h, R, IDX, call, uid, isGM, damageText, attrName, skillName, currentActor, tierDef } from './util.js';

export function compendiumSubtitle(pack, e) {
  switch (pack) {
    case 'weapons': return `${e.forms.padrao.name} / ${e.forms.truque.name}${e.legendary ? ' · lendária' : e.basic ? ' · básica' : ''}`;
    case 'revolvers': return `${damageText(e.damage)} · ${e.pa} PA`;
    case 'channelers': return `${e.kind}${e.academy ? ` · ${e.academy}` : ''}`;
    case 'arcana': return `${R().classes.academies.find(a => a.id === e.academy)?.name} · D${e.discernment} · ${e.pa} PA`;
    case 'marks': return `D${e.discernment} · ${e.pa} PA · ${IDX().items[e.material]?.name || e.material}`;
    case 'talents': return `${e.category}${e.classOnly ? ` · ${R().classes.classes.find(c => c.id === e.classOnly)?.name}` : ''}`;
    case 'mutations': return R().dementia.mutationGrades.find(g => g.id === e.grade)?.name || e.grade;
    case 'items': return `${e.category} · ${e.price} Ecos${e.per ? ` (${e.per})` : ''}`;
    case 'bestiary': return `${e.category} · ${tierDef(e.tier)?.name} · Limiar ${e.limiar} · Vida ${e.hp}`;
    case 'ascendants': return 'Ascendente · Desconhecido';
    case 'tables': return `${e.dice} · ${e.results.length} resultados`;
    case '_states': return `${e.icon || ''} ${e.group}${e.category ? ` · ${e.category}` : ''}`;
    default: return '';
  }
}

export function renderCompendiumEntry(pack, e) {
  const box = h('div.selectable');
  const p = (label, text) => text ? h('div', h('b', `${label}: `), text) : null;
  switch (pack) {
    case 'weapons':
      for (const [key, f] of Object.entries(e.forms)) {
        box.append(h('div.weapon-card',
          h('div', h('b', key === 'padrao' ? 'Forma Padrão: ' : 'Forma de Truque: '), f.name),
          h('div.small', `${f.category === 'agil' ? 'Ágil' : f.category === 'pesada' ? 'Pesada' : 'Disparo'} · ${f.hands === 2 ? 'Duas Mãos' : 'Uma Mão'} · ${damageText(f.damage)}${f.trick ? ` + ${damageText(f.trick)} fixo (Truque)` : ''}`),
          f.text ? h('div.small.muted', f.text) : null));
      }
      box.append(h('p', { style: { fontStyle: 'italic' } }, e.text || ''), p('Espaços de carga', String(e.slots ?? 2)), e.price ? p('Preço', `${e.price} Ecos`) : null);
      break;
    case 'revolvers':
      box.append(p('Dano', damageText(e.damage)), p('Custo', `${e.pa} PA`), p('Tambor', `${e.ammoCapacity}`), p('Traço', e.text), p('Preço', `${e.price} Ecos`));
      break;
    case 'channelers':
      box.append(p('Tipo', e.kind), p('Academia', e.academy || 'Qualquer'), p('Efeito', e.text), h('p.small.muted', '+1 Espaço de Magia. Sempre Uma Mão. Não é afetado pelo TOC.'));
      break;
    case 'arcana': {
      const ac = R().classes.academies.find(a => a.id === e.academy);
      const costs = [`${e.pa} PA`];
      if (e.costs?.flasks) costs.push(`${e.costs.flasks} Frasco(s) de Sangue`);
      if (e.costs?.hp) costs.push(`${e.costs.hp} de Vida própria`);
      if (e.costs?.dementia) costs.push(`${e.costs.dementia} Dementia`);
      if (e.costs?.selfDamage) costs.push(`${e.costs.selfDamage.dice} ${e.costs.selfDamage.type} em si`);
      box.append(p('Academia', `${ac?.name} (${ac?.roll.map((x, i) => i ? skillName(x) : attrName(x)).join(' + ')})`), p('Discernimento', String(e.discernment)), p('Custo', costs.join(' + ')),
        p('Recarga', e.noCooldown ? 'nenhuma' : '3 turnos (Regra Magicka)'), e.requirement ? p('Requisito', e.requirement) : null, h('p', e.text));
      break;
    }
    case 'marks':
      box.append(p('Discernimento', String(e.discernment)), p('Rolagem', e.roll ? `${attrName(e.roll[0])} + ${skillName(e.roll[1])}` : 'sem rolagem'), p('Material', IDX().items[e.material]?.name || e.material), p('Custo', e.reaction ? 'reação' : `${e.pa} PA`), h('p', e.text));
      break;
    case 'bestiary': case 'ascendants': {
      const unknown = e.unknown;
      const v = (x) => unknown || x == null ? 'Desconhecido' : x;
      box.append(e.quote ? h('p', { style: { fontStyle: 'italic' } }, `“${e.quote}”`) : null,
        h('div.statblock', `LIMIAR ${v(e.limiar)} · DADOS ${v(e.dice)} · VIDA ${v(e.hp)}${e.hpPerHunter ? ` (${e.hpPerHunter} por caçador)` : ''} · PA ${v(e.pa)} · ECOS ${v(e.ecos)}`),
        p('Fraqueza', unknown ? 'Desconhecida' : (e.weaknesses || []).join(', ') || '—'), p('Resistência', unknown ? 'Desconhecida' : (e.resistances || []).join(', ') || 'Nenhuma'),
        ...(e.attacks || []).map(a => p(a.name, `${a.pa ?? 2} PA · ${damageText(a.damage)}${a.range ? ` · ${a.range} m` : ''}${a.text ? ` · ${a.text}` : ''}`)),
        ...(e.abilities || []).map(a => p(a.name, a.text)),
        ...(e.phases || []).map(ph => p(ph.name, ph.text)),
        e.noOpportunity ? h('div.small.muted', 'Não faz ataques de oportunidade.') : null,
        h('p', e.text || ''),
        isGM() ? h('p.small.gold', 'Arraste para o mapa para criar a criatura (Alt ao soltar: entra oculta).') : null);
      break;
    }
    case 'tables':
      box.append(...e.results.map(r => h('div.small', h('b', `${r.range[0]}${r.range[1] !== r.range[0] ? `–${r.range[1]}` : ''}: `), r.text)), h('button', { onclick: () => call('chat:rollTable', { id: e.id }) }, `🎲 Rolar ${e.dice}`));
      break;
    case '_states':
      box.append(p('Grupo', e.group), e.category ? p('Categoria', e.category) : null, h('p', e.text), e.dot ? p('Dano contínuo', `${e.dot.dice} ${e.dot.type} no início do turno`) : null, e.rounds ? p('Duração', `${e.rounds} turnos`) : null);
      break;
    default:
      box.append(h('p', e.text || ''), e.price != null ? p('Preço', `${e.price} Ecos`) : null);
  }
  const addable = ['weapons', 'revolvers', 'channelers', 'arcana', 'marks', 'talents', 'mutations', 'items'];
  if (addable.includes(pack)) {
    const actor = currentActor();
    if (actor) box.append(h('div.row', { style: { marginTop: '10px' } }, h('button.primary', { onclick: () => addToActor(actor, pack, e) }, `Adicionar a ${actor.name}`)));
    else box.append(h('p.small.muted', 'Arraste para uma ficha aberta para adicionar.'));
  }
  return box;
}

// Adiciona uma entrada do compêndio à ficha (o servidor valida permissões e requisitos).
export async function addToActor(actor, pack, entry) {
  if (!actor || !entry) return;
  if (actor.type !== 'hunter') { ctx.app.ui.toast('Só caçadores recebem itens do compêndio.', 'error'); return; }
  const d = actor.data;
  const up = (data) => call('actor:update', { id: actor.id, data });
  let res;
  switch (pack) {
    case 'weapons': {
      const f = entry.forms.padrao.ranged ? entry.forms.padrao : entry.forms.truque?.ranged ? entry.forms.truque : null;
      const inst = { uid: uid(), ref: entry.id, form: 'padrao', reforco: 0, ...(f ? { ammo: f.ammoCapacity } : {}) };
      res = await up({ weapons: [...d.weapons, inst], ...(d.equip.main ? {} : { equip: { main: inst.uid } }) });
      break;
    }
    case 'revolvers': {
      const inst = { uid: uid(), ref: entry.id, ammo: entry.ammoCapacity };
      res = await up({ revolvers: [...d.revolvers, inst], ...(d.equip.off ? {} : { equip: { off: inst.uid } }) });
      break;
    }
    case 'channelers': {
      const inst = { uid: uid(), ref: entry.id, afinacao: 0 };
      res = await up({ channelers: [...d.channelers, inst], ...(d.equip.off ? {} : { equip: { off: inst.uid } }) });
      break;
    }
    case 'arcana': res = await up({ arcana: { known: [...new Set([...(d.arcana.known || []), entry.id])] } }); break;
    case 'marks': res = await up({ marks: [...new Set([...(d.marks || []), entry.id])] }); break;
    case 'talents': res = await up({ talents: [...new Set([...(d.talents || []), entry.id])] }); break;
    case 'mutations': res = await up({ mutations: [...new Set([...(d.mutations || []), entry.id])] }); break;
    case 'items': {
      const existing = (d.inventory || []).find(i => i.ref === entry.id);
      const qty = entry.per || 1;
      const inventory = existing ? d.inventory.map(i => i === existing ? { ...i, qty: i.qty + qty } : i) : [...(d.inventory || []), { uid: uid(), ref: entry.id, name: entry.name, qty }];
      res = await up({ inventory });
      break;
    }
    default: return;
  }
  if (res && !res.error) ctx.app.ui.toast(`${entry.name} adicionado a ${actor.name}.`, 'ok');
}
