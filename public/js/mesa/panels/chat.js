// Chat: mensagens, sussurros, rolagens e cartões do sistema.
import { state, on, isGM, isSpectator, myActor, canControl } from '../state.js';
import { call } from '../net.js';
import { h, esc, fmtTime } from '../ui.js';

export function chatPanel(app, panel, { badge }) {
  const log = h('div#chatLog', { 'aria-live': 'polite' });
  const input = h('textarea#chatInput', { placeholder: 'Mensagem ou comando (/ajuda). Enter envia, Shift+Enter quebra linha.', rows: 2 });
  const speaker = h('select', { title: 'Falar/rolar como' });
  const blind = h('input', { type: 'checkbox', title: 'Rolagem oculta: só o Mestre vê' });
  const form = h('form#chatForm',
    input,
    h('div.chat-opts',
      h('span.muted', 'Como:'), speaker,
      isGM() ? h('label.row', blind, 'Oculta') : null,
      h('span.right.muted.small', { id: 'targetInfo' })));
  panel.append(log, form);

  const history = [];
  let hIndex = -1;
  let unread = 0;

  function refreshSpeakers() {
    const opts = [...state.actors.values()].filter(a => canControl(a) && a.full);
    const cur = state.speakerActorId || myActor()?.id || '';
    speaker.replaceChildren(h('option', { value: '' }, state.user.name), ...opts.map(a => h('option', { value: a.id, selected: a.id === cur }, a.name)));
  }
  speaker.addEventListener('change', () => { state.speakerActorId = speaker.value ? Number(speaker.value) : null; });

  function refreshTargets() {
    const n = state.targets.size;
    const el = form.querySelector('#targetInfo');
    el.textContent = n ? `🎯 ${n} alvo(s)` : '';
  }

  async function send() {
    let text = input.value.trim();
    if (!text) return;
    if (isSpectator() && !text.startsWith('/w')) { /* espectadores podem conversar */ }
    history.unshift(text); hIndex = -1;
    if (blind.checked && text.startsWith('/') && !text.startsWith('/gm') && !text.startsWith('/w')) text = '/gm ' + text.slice(1);
    input.value = '';
    await call('chat:send', { text, actorId: speaker.value ? Number(speaker.value) : null, targets: [...state.targets] });
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'ArrowUp' && !input.value.includes('\n') && history.length) { hIndex = Math.min(history.length - 1, hIndex + 1); input.value = history[hIndex]; e.preventDefault(); }
    else if (e.key === 'ArrowDown' && hIndex >= 0) { hIndex--; input.value = hIndex >= 0 ? history[hIndex] : ''; e.preventDefault(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });

  function renderMessage(m) {
    const el = h('div.msg', { dataset: { id: m.id } });
    if (m.whisper) el.classList.add('whisper');
    if (m.blind) el.classList.add('blind');
    if (m.type === 'system') el.classList.add('system');
    if (m.type === 'emote') el.classList.add('emote');
    const author = m.author;
    const meta = h('div.meta',
      author ? h('span.author', { style: { color: author.color } }, m.data?.speaker && m.type !== 'emote' ? `${m.data.speaker} (${author.name})` : author.name) : null,
      m.whisper ? h('span', `sussurro${m.whisperNames?.length ? ' para ' + m.whisperNames.join(', ') : ''}`) : null,
      m.blind ? h('span.danger', 'oculta') : null,
      h('span.time', fmtTime(m.created_at)));
    if (m.type !== 'system') el.append(meta);
    const body = h('div.body.selectable');
    switch (m.type) {
      case 'text': case 'whisper': body.innerHTML = m.content.replace(/\n/g, '<br>'); break;
      case 'emote': body.innerHTML = `<b>${esc(m.data?.speaker || author?.name || '')}</b> ${m.content}`; break;
      case 'system': body.innerHTML = m.content; break;
      case 'roll': renderRoll(m, body); break;
      case 'table': body.append(h('div.card-title', `🎲 ${m.data.table}`), h('div.card-sub', `${m.data.roll.formula} = ${m.data.roll.total}`), h('div', m.data.result)); break;
      case 'sys':
        if (app.system?.renderChatCard) app.system.renderChatCard(m, body, app);
        else body.textContent = JSON.stringify(m.data);
        break;
      default: body.textContent = m.content;
    }
    el.append(body);
    if (isGM() && m.id > 0) {
      const tools = h('div.del.row',
        m.blind ? h('button.small.ghost', { title: 'Revelar para todos', onclick: () => call('chat:reveal', { id: m.id }) }, '👁') : null,
        h('button.small.ghost', { title: 'Apagar', onclick: () => call('chat:delete', { id: m.id }) }, '✕'));
      el.append(tools);
    }
    return el;
  }

  function renderRoll(m, body) {
    const r = m.data.roll;
    const dice = h('div.dice');
    for (const p of r.parts) {
      if (p.sides) for (const v of p.results) dice.append(h('span.die', { title: `d${p.sides}` }, v));
      else dice.append(h('span.muted', `${p.sign < 0 ? '−' : '+'}${p.value}`));
    }
    body.append(h('div.card-sub', r.formula), dice, h('div.roll-total', `= ${r.total}`));
    if (isGM() && app.system?.rollButtons) body.append(app.system.rollButtons(r.total, app));
  }

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  function append(m) {
    const stick = atBottom();
    log.append(renderMessage(m));
    if (stick) log.scrollTop = log.scrollHeight;
    if (!panel.classList.contains('active')) badge(++unread);
  }
  function renderAll() {
    log.replaceChildren(...state.chat.map(renderMessage));
    log.scrollTop = log.scrollHeight;
  }

  // Mensagens locais (ex.: sussurros da Dementia, só na tela deste jogador).
  app.localMessage = (html, cls = 'whisper-fx') => {
    const el = h('div.msg', { class: `msg ${cls}` }, h('div.body', { html }));
    const stick = atBottom();
    log.append(el);
    if (stick) log.scrollTop = log.scrollHeight;
  };

  on('chat:message', append);
  on('chat:update', (m) => { const old = log.querySelector(`.msg[data-id="${m.id}"]`); if (old) old.replaceWith(renderMessage(m)); });
  on('chat:delete', (id) => log.querySelector(`.msg[data-id="${id}"]`)?.remove());
  on('chat:reset', renderAll);
  on('world:reset', () => { renderAll(); refreshSpeakers(); refreshTargets(); });
  on('actors', refreshSpeakers);
  on('selection', refreshSpeakers);
  on('targets', refreshTargets);
  on('tab', (id) => { if (id === 'chat') { unread = 0; badge(0); log.scrollTop = log.scrollHeight; } });
}
