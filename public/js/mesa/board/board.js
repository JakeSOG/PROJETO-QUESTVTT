// O mapa (PixiJS v8): câmera, grade, tokens, paredes, luzes, névoa, visão, régua e ferramentas.
import * as PIXI from '/vendor/pixi/pixi.min.mjs';
import { state, on, emit, isGM, canControl } from '../state.js';
import { call } from '../net.js';
import { h, toast, contextMenu, formDialog, confirmDialog } from '../ui.js';
import { TokenView } from './tokens.js';
import { VisionRenderer, blockingSegments } from './vision.js';

export async function initBoard(app) {
  const el = document.getElementById('board');
  const pixi = new PIXI.Application();
  await pixi.init({ resizeTo: el, background: '#050403', antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  el.append(pixi.canvas);
  pixi.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Camadas ----------
  const world = new PIXI.Container();
  const L = {
    bg: new PIXI.Container(),
    grid: new PIXI.Graphics(),
    lightColor: new PIXI.Sprite(),
    tokens: new PIXI.Container(),
    darkness: new PIXI.Sprite(),
    fog: new PIXI.Sprite(),
    walls: new PIXI.Graphics(),
    doors: new PIXI.Container(),
    lightIcons: new PIXI.Container(),
    draw: new PIXI.Graphics(),
    ruler: new PIXI.Container(),
    pings: new PIXI.Container()
  };
  L.tokens.sortableChildren = true;
  world.addChild(L.bg, L.grid, L.lightColor, L.tokens, L.darkness, L.fog, L.walls, L.doors, L.lightIcons, L.draw, L.ruler, L.pings);
  pixi.stage.addChild(world);
  pixi.stage.eventMode = 'static';
  pixi.stage.hitArea = pixi.screen;
  L.lightColor.blendMode = 'add';
  L.lightColor.alpha = 0.35;
  for (const l of [L.darkness, L.fog, L.lightColor]) l.eventMode = 'none';

  const emptyText = new PIXI.Text({ text: '', style: { fontFamily: 'Cinzel, serif', fontSize: 20, fill: 0x7a6040, align: 'center' } });
  emptyText.anchor.set(0.5);
  pixi.stage.addChild(emptyText);

  const vision = new VisionRenderer();
  let darkTex = null, fogTex = null, colorTex = null;
  const tokenViews = new Map();
  let bgSprite = null;

  // ---------- Utilidades ----------
  const sceneData = () => state.scene?.scene.data;
  const gridSize = () => sceneData()?.grid?.size || 70;
  const metersToPx = () => gridSize() / (sceneData()?.grid?.units || 1.5);
  const screenToWorld = (x, y) => world.toLocal(new PIXI.Point(x, y));
  const snap = (v, off = 0) => Math.round((v - off) / gridSize()) * gridSize() + off;
  const snapHalf = (v) => Math.round(v / (gridSize() / 2)) * (gridSize() / 2);
  const tokenCenter = (t) => ({ x: t.data.x + gridSize() * (t.data.size || 1) / 2, y: t.data.y + gridSize() * (t.data.size || 1) / 2 });

  const board = {
    app, pixi, world, gridSize, screenToWorld, tokenViews,
    centerOn(x, y) {
      world.position.set(pixi.screen.width / 2 - x * world.scale.x, pixi.screen.height / 2 - y * world.scale.y);
    },
    tokenCenter
  };
  app.board = board;

  // ---------- Câmera ----------
  const camKey = () => `qvtt.cam.${state.scene?.scene.id}`;
  function saveCamera() {
    try { localStorage.setItem(camKey(), JSON.stringify({ x: world.position.x, y: world.position.y, s: world.scale.x })); } catch { /* sem armazenamento */ }
  }
  function restoreCamera() {
    let cam = null;
    try { cam = JSON.parse(localStorage.getItem(camKey()) || 'null'); } catch { cam = null; }
    if (cam) { world.scale.set(cam.s); world.position.set(cam.x, cam.y); return; }
    const d = sceneData();
    if (!d) return;
    const s = Math.min(pixi.screen.width / d.width, pixi.screen.height / d.height, 1);
    world.scale.set(s);
    board.centerOn(d.width / 2, d.height / 2);
  }
  pixi.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = pixi.canvas.getBoundingClientRect();
    const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const s = Math.max(0.08, Math.min(4, world.scale.x * factor));
    world.scale.set(s);
    const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    world.position.x += (after.x - before.x) * s;
    world.position.y += (after.y - before.y) * s;
    saveCameraSoon();
  }, { passive: false });
  let camTimer = null;
  const saveCameraSoon = () => { clearTimeout(camTimer); camTimer = setTimeout(saveCamera, 400); };

  // ---------- Cena ----------
  let loadGen = 0;
  function updateBadge() {
    const badge = document.getElementById('sceneBadge');
    const sc = state.scene;
    if (isGM() && sc && sc.scene.id !== state.activeSceneId) { badge.textContent = 'Você está vendo uma cena que os jogadores não veem'; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
  async function loadScene() {
    const gen = ++loadGen;
    for (const v of tokenViews.values()) v.destroy();
    tokenViews.clear();
    L.bg.removeChildren().forEach(c => c.destroy());
    bgSprite = null;
    const sc = state.scene;
    document.getElementById('sceneTitle').textContent = sc ? sc.scene.name : 'Nenhuma cena';
    updateBadge();
    if (!sc) {
      emptyText.text = isGM() ? 'Nenhuma cena ainda.\nCrie uma na aba 🗺 Cenas.' : 'O Mestre ainda não abriu uma cena.';
      emptyText.position.set(pixi.screen.width / 2, pixi.screen.height / 2);
      emptyText.visible = true;
      world.visible = false;
      return;
    }
    emptyText.visible = false;
    world.visible = true;
    const d = sc.scene.data;
    const bgRect = new PIXI.Graphics().rect(0, 0, d.width, d.height).fill({ color: d.bgColor || '#0b0908' });
    L.bg.addChild(bgRect);
    if (d.background) {
      try {
        const tex = await PIXI.Assets.load(d.background);
        if (gen !== loadGen) return;
        if (state.scene?.scene.id === sc.scene.id) {
          bgSprite = new PIXI.Sprite(tex);
          bgSprite.width = d.width; bgSprite.height = d.height;
          L.bg.addChild(bgSprite);
        }
      } catch { toast('Não foi possível carregar a imagem do mapa.', 'error'); }
      if (gen !== loadGen) return;
    }
    drawGrid();
    vision.resize(d.width, d.height);
    for (const [key, canvas] of [['dark', vision.dark], ['fog', vision.fog], ['color', vision.color]]) {
      // Textura nova a cada carga (sem o cache do Texture.from, que reaproveitaria a destruída).
      const tex = new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: canvas }) });
      if (key === 'dark') { darkTex?.destroy(true); darkTex = tex; L.darkness.texture = tex; }
      if (key === 'fog') { fogTex?.destroy(true); fogTex = tex; L.fog.texture = tex; }
      if (key === 'color') { colorTex?.destroy(true); colorTex = tex; L.lightColor.texture = tex; }
    }
    for (const s of [L.darkness, L.fog, L.lightColor]) { s.width = d.width; s.height = d.height; }
    for (const t of sc.tokens.values()) upsertToken(t);
    drawWalls();
    drawLightIcons();
    renderFog();
    restoreCamera();
    scheduleVision();
  }

  function drawGrid() {
    const d = sceneData();
    L.grid.clear();
    if (!d || !d.grid.show) return;
    const g = d.grid;
    const ox = ((g.offsetX % g.size) + g.size) % g.size, oy = ((g.offsetY % g.size) + g.size) % g.size;
    for (let x = ox; x <= d.width; x += g.size) L.grid.moveTo(x, 0).lineTo(x, d.height);
    for (let y = oy; y <= d.height; y += g.size) L.grid.moveTo(0, y).lineTo(d.width, y);
    L.grid.stroke({ width: 1, color: g.color || '#000000', alpha: g.alpha ?? 0.3 });
  }

  // ---------- Tokens ----------
  function upsertToken(t) {
    let v = tokenViews.get(t.id);
    if (!v) {
      v = new TokenView(board, t);
      tokenViews.set(t.id, v);
      L.tokens.addChild(v.root);
      bindTokenEvents(v);
    } else v.update(t);
    v.root.zIndex = t.data.disposition === 'corpse' ? 0 : (t.data.size || 1) >= 2 ? 1 : 2;
  }

  function removeToken(id) {
    const v = tokenViews.get(id);
    if (v) { v.destroy(); tokenViews.delete(id); }
  }

  let lastDown = { id: null, time: 0 };
  let dragging = null;
  let hoverToken = null;

  function bindTokenEvents(v) {
    v.root.on('pointerover', () => { hoverToken = v.id; });
    v.root.on('pointerout', () => { if (hoverToken === v.id) hoverToken = null; });
    v.root.on('pointerdown', (e) => {
      const token = v.token;
      if (!token) return;
      if (e.button === 2) { e.stopPropagation(); tokenMenu(v, e.global); return; }
      if (e.button !== 0) return;
      if (tool === 'walls' || tool === 'lights' || tool === 'fog' || tool === 'ruler') return;
      e.stopPropagation();
      if (tool === 'target') { toggleTarget(v.id); return; }
      // Duplo clique abre a ficha
      const now = performance.now();
      if (lastDown.id === v.id && now - lastDown.time < 320) { openTokenSheet(token); lastDown = { id: null, time: 0 }; return; }
      lastDown = { id: v.id, time: now };
      // Seleção
      if (!e.shiftKey && !state.selected.has(v.id)) state.selected.clear();
      state.selected.add(v.id);
      if (token.actor_id && canControl(state.actors.get(token.actor_id))) state.speakerActorId = token.actor_id;
      emit('selection');
      // Arrastar (só quem controla)
      const canDrag = isGM() || (token.actor_id && state.actors.get(token.actor_id)?.owner_id === state.user.id && state.user.role === 'player');
      if (canDrag && token.data.disposition !== 'corpse' || (isGM() && token.data.disposition === 'corpse')) {
        const p = screenToWorld(e.global.x, e.global.y);
        dragging = { view: v, dx: p.x - token.data.x, dy: p.y - token.data.y, start: { x: token.data.x, y: token.data.y }, moved: false };
        v.dragging = true;
        v.root.alpha = 0.8;
      }
    });
  }

  function openTokenSheet(token) {
    if (!token.actor_id) return;
    const actor = state.actors.get(token.actor_id);
    if (!actor) return;
    if (app.system?.openSheet) app.system.openSheet(actor);
  }

  function toggleTarget(id) {
    if (state.targets.has(id)) state.targets.delete(id); else state.targets.add(id);
    emit('targets');
  }
  board.toggleTarget = toggleTarget;

  async function finishDrag(e) {
    const dr = dragging;
    dragging = null;
    if (!dr) return;
    dr.view.dragging = false;
    dr.view.root.alpha = 1;
    const token = dr.view.token;
    if (!token || !dr.moved) { dr.view.root.position.set(token?.data.x ?? 0, token?.data.y ?? 0); return; }
    const g = sceneData().grid;
    let x = dr.view.root.position.x, y = dr.view.root.position.y;
    if (!e.shiftKey) { x = snap(x, g.offsetX % g.size); y = snap(y, g.offsetY % g.size); }
    dr.view.root.position.set(x, y); // otimista
    const res = await call('token:move', { id: token.id, x, y }, { silent: true });
    if (res.error) {
      toast(res.error, 'error');
      const back = res.token || token;
      dr.view.root.position.set(back.data.x, back.data.y);
    }
  }

  function tokenMenu(v, global) {
    const token = v.token;
    const actor = token.actor_id ? state.actors.get(token.actor_id) : null;
    const rect = pixi.canvas.getBoundingClientRect();
    const items = [];
    if (actor) items.push({ label: '📜 Abrir ficha', action: () => openTokenSheet(token) });
    items.push({ label: state.targets.has(v.id) ? '🎯 Remover alvo' : '🎯 Marcar como alvo', action: () => toggleTarget(v.id) });
    if (app.system?.tokenMenu) items.push(...app.system.tokenMenu(actor, token));
    if (token.data.disposition === 'corpse' && app.system?.corpseMenu) items.push(...app.system.corpseMenu(token));
    if (isGM()) {
      items.push('-');
      items.push({ label: token.data.hidden ? '👁 Revelar token' : '🙈 Ocultar token', action: () => call('token:update', { id: token.id, data: { hidden: !token.data.hidden } }) });
      items.push({ label: '⚙ Configurar token', action: () => configureToken(token) });
      items.push({ label: '📍 Centralizar todos aqui', action: () => { const c = tokenCenter(token); call('map:pan', c); } });
      items.push({ label: '🗑 Remover do mapa', action: async () => { if (await confirmDialog('Remover token', `Remover <b>${token.data.name}</b> do mapa?`, { danger: true, okLabel: 'Remover' })) call('token:delete', { id: token.id }); } });
    }
    contextMenu(rect.left + global.x, rect.top + global.y, items);
  }

  async function configureToken(token) {
    const d = token.data;
    const r = await formDialog(`Token: ${d.name}`, [
      { name: 'name', label: 'Nome', value: d.name },
      { name: 'size', label: 'Tamanho (quadrados)', type: 'number', value: d.size || 1, step: 0.5, min: 0.5 },
      { name: 'disposition', label: 'Lado', type: 'select', value: d.disposition, options: [{ value: 'hunter', label: 'Caçador' }, { value: 'creature', label: 'Criatura' }, { value: 'neutral', label: 'Neutro' }, { value: 'corpse', label: 'Cadáver' }] },
      { name: 'showName', label: 'Mostrar nome', type: 'select', value: d.showName, options: [{ value: 'all', label: 'Sempre' }, { value: 'hover', label: 'Ao passar o mouse' }, { value: 'gm', label: 'Só para o Mestre' }] },
      { name: 'rotation', label: 'Rotação (graus)', type: 'number', value: d.rotation || 0 },
      { name: 'visionEnabled', label: 'Tem visão (jogador)', type: 'checkbox', value: d.vision?.enabled },
      { name: 'visionRange', label: 'Alcance da visão (m, vazio = ilimitado)', type: 'number', value: d.vision?.range ?? '' },
      { name: 'visionDim', label: 'Enxerga no escuro ao redor (m)', type: 'number', value: d.vision?.dim ?? 1.5, step: 0.5 },
      { name: 'lightRadius', label: 'Luz própria (m) — lampião 6, tocha 4', type: 'number', value: d.light?.radius || 0, step: 0.5 },
      { name: 'lightColor', label: 'Cor da luz', type: 'color', value: d.light?.color || '#ffc36b' },
      { name: 'ecos', label: 'Ecos (cadáver)', type: 'number', value: d.ecos ?? '' },
      { name: 'img', label: 'Imagem (URL)', value: d.img || '' }
    ], { width: 480 });
    if (!r) return;
    call('token:update', { id: token.id, data: {
      name: r.name, size: r.size, disposition: r.disposition, showName: r.showName, rotation: r.rotation, img: r.img || null,
      vision: { enabled: r.visionEnabled, range: r.visionRange === null ? null : r.visionRange, dim: r.visionDim ?? 1.5 },
      light: { radius: r.lightRadius || 0, color: r.lightColor }, ...(r.ecos !== null ? { ecos: r.ecos } : {})
    } });
  }

  // ---------- Paredes e portas ----------
  function drawWalls() {
    L.walls.clear();
    L.doors.removeChildren().forEach(c => c.destroy());
    const sc = state.scene;
    if (!sc) return;
    const showWalls = isGM() && (tool === 'walls' || showAllWalls);
    for (const w of sc.walls.values()) {
      const d = w.data;
      if (showWalls) {
        const color = d.door ? (d.open ? 0x6b9a3a : 0xb22a2a) : 0xd4a017;
        L.walls.moveTo(d.x1, d.y1).lineTo(d.x2, d.y2).stroke({ width: 4 / world.scale.x, color, alpha: 0.9 });
        L.walls.circle(d.x1, d.y1, 3 / world.scale.x).fill({ color }).circle(d.x2, d.y2, 3 / world.scale.x).fill({ color });
      }
      if (d.door) {
        const icon = new PIXI.Text({ text: d.open ? '🚪' : '🔒', style: { fontSize: Math.max(16, gridSize() * 0.32) } });
        icon.anchor.set(0.5);
        icon.position.set((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2);
        icon.eventMode = 'static';
        icon.cursor = 'pointer';
        icon.alpha = d.open ? 0.6 : 0.95;
        icon.wallId = w.id;
        icon.on('pointerdown', (e) => {
          e.stopPropagation();
          if (e.button === 2 && isGM()) { call('wall:delete', { id: w.id }); return; }
          call('wall:door', { id: w.id, open: !d.open });
        });
        L.doors.addChild(icon);
      }
    }
    updateDoorVisibility();
  }

  function updateDoorVisibility() {
    const useVision = !isGM() && sceneData()?.vision;
    for (const icon of L.doors.children) icon.visible = !useVision || vision.isVisible(icon.x, icon.y) || isNearOwnToken(icon.x, icon.y);
  }
  function isNearOwnToken(x, y) {
    const r = gridSize() * 2;
    for (const t of state.scene?.tokens.values() || []) {
      const a = t.actor_id ? state.actors.get(t.actor_id) : null;
      if (!a || a.owner_id !== state.user.id) continue;
      const c = tokenCenter(t);
      if (Math.hypot(c.x - x, c.y - y) < r) return true;
    }
    return false;
  }

  // ---------- Luzes (ícones do Mestre) ----------
  let lightDrag = null;
  function drawLightIcons() {
    L.lightIcons.removeChildren().forEach(c => c.destroy());
    if (!isGM() || !state.scene) return;
    const show = tool === 'lights' || showAllWalls;
    for (const l of state.scene.lights.values()) {
      const c = new PIXI.Container();
      const g = new PIXI.Graphics();
      const r = Math.max(10, gridSize() * 0.22);
      g.circle(0, 0, r).fill({ color: 0x14100d, alpha: 0.85 }).stroke({ width: 2, color: l.data.off ? 0x555555 : parseInt(l.data.color.slice(1), 16) });
      if (show) g.circle(0, 0, l.data.radius * metersToPx()).stroke({ width: 1.5 / world.scale.x, color: parseInt(l.data.color.slice(1), 16), alpha: 0.35 });
      const t = new PIXI.Text({ text: l.data.off ? '○' : '✹', style: { fontSize: r * 1.3, fill: l.data.off ? 0x777777 : 0xffd27a } });
      t.anchor.set(0.5);
      c.addChild(g, t);
      c.position.set(l.data.x, l.data.y);
      c.visible = show;
      c.eventMode = 'static';
      c.cursor = 'grab';
      c.on('pointerdown', (e) => {
        e.stopPropagation();
        if (e.button === 2) { lightMenu(l, e.global); return; }
        lightDrag = { id: l.id, view: c, moved: false };
      });
      L.lightIcons.addChild(c);
    }
  }

  function lightMenu(l, global) {
    const rect = pixi.canvas.getBoundingClientRect();
    contextMenu(rect.left + global.x, rect.top + global.y, [
      { label: '✎ Editar luz', action: () => editLight(l) },
      { label: l.data.off ? '✹ Acender' : '○ Apagar', action: () => call('light:update', { id: l.id, data: { off: !l.data.off } }) },
      { label: '🗑 Remover luz', action: () => call('light:delete', { id: l.id }) }
    ]);
  }
  async function editLight(l) {
    const r = await formDialog('Luz', [
      { name: 'radius', label: 'Raio (m)', type: 'number', value: l.data.radius, step: 0.5 },
      { name: 'color', label: 'Cor', type: 'color', value: l.data.color },
      { name: 'flicker', label: 'Tremular (chama)', type: 'checkbox', value: l.data.flicker },
      { name: 'hidden', label: 'Oculta dos jogadores (ícone)', type: 'checkbox', value: l.data.hidden },
      { name: 'off', label: 'Apagada', type: 'checkbox', value: l.data.off }
    ]);
    if (r) call('light:update', { id: l.id, data: r });
  }

  // ---------- Visão / escuridão ----------
  let visionQueued = false;
  function scheduleVision() {
    if (visionQueued) return;
    visionQueued = true;
    requestAnimationFrame(() => { visionQueued = false; computeVision(); });
  }
  const flick = new Map();
  function computeVision() {
    const sc = state.scene;
    if (!sc || !darkTex) return;
    const d = sc.scene.data;
    const mpx = metersToPx();
    const gm = isGM();
    const segs = blockingSegments([...sc.walls.values()]);
    const lights = [];
    for (const l of sc.lights.values()) {
      if (l.data.off) continue;
      lights.push({ id: `l${l.id}`, x: l.data.x, y: l.data.y, r: l.data.radius * mpx, dim: 0.55, color: l.data.color, flick: l.data.flicker ? (flick.get(l.id) || 1) : 1 });
    }
    const eyes = [], personal = [];
    for (const t of sc.tokens.values()) {
      const c = tokenCenter(t);
      if (t.data.light?.radius > 0) lights.push({ id: `t${t.id}`, x: c.x, y: c.y, r: t.data.light.radius * mpx, dim: 0.55, color: t.data.light.color, flick: flick.get(`t${t.id}`) || 1 });
      const extra = app.system?.tokenLight ? app.system.tokenLight(t, t.actor_id ? state.actors.get(t.actor_id) : null) : null;
      if (extra) lights.push({ id: `x${t.id}`, x: c.x, y: c.y, r: extra.radius * mpx, dim: 0.55, color: extra.color || '#ffb85c', flick: flick.get(`t${t.id}`) || 1 });
      if (gm) continue;
      const actor = t.actor_id ? state.actors.get(t.actor_id) : null;
      if (!actor || actor.owner_id !== state.user.id || !t.data.vision?.enabled) continue;
      eyes.push({ id: t.id, x: c.x, y: c.y, range: t.data.vision.range ? t.data.vision.range * mpx : null });
      if (t.data.vision.dim > 0) personal.push({ id: `p${t.id}`, x: c.x, y: c.y, r: t.data.vision.dim * mpx + gridSize() / 2 });
    }
    if (vision.cache.size > 600) vision.invalidate();
    vision.render(segs, { lights, eyes, personal }, {
      enabled: !!d.vision,
      darkness: gm ? (d.gmDarkness ?? 0.45) : (d.darkness ?? 0.9),
      clipToEyes: !gm && eyes.length > 0
    });
    darkTex.source.update();
    colorTex.source.update();
    L.darkness.visible = !!d.vision;
    L.lightColor.visible = !!d.vision;
    updateTokenVisibility();
    updateDoorVisibility();
  }

  function updateTokenVisibility() {
    const gm = isGM();
    const useVision = sceneData()?.vision || sceneData()?.fog;
    for (const v of tokenViews.values()) {
      const t = v.token;
      if (!t) continue;
      if (gm || !useVision) { v.root.visible = true; continue; }
      const a = t.actor_id ? state.actors.get(t.actor_id) : null;
      if (a && a.owner_id === state.user.id) { v.root.visible = true; continue; }
      const c = tokenCenter(t);
      v.root.visible = vision.isVisible(c.x, c.y);
    }
  }

  function renderFog() {
    const sc = state.scene;
    if (!sc || !fogTex) return;
    vision.renderFog(sc.fog.shapes, !!sc.scene.data.fog);
    fogTex.source.update();
    L.fog.alpha = isGM() ? 0.45 : 1;
    L.fog.visible = !!sc.scene.data.fog;
    updateTokenVisibility();
  }

  // Tremular das chamas (~7 vezes por segundo).
  setInterval(() => {
    const sc = state.scene;
    if (!sc || !sc.scene.data.vision) return;
    let any = false;
    for (const l of sc.lights.values()) if (l.data.flicker && !l.data.off) { flick.set(l.id, 0.95 + Math.random() * 0.08); any = true; }
    for (const t of sc.tokens.values()) if (t.data.light?.radius > 0) { flick.set(`t${t.id}`, 0.96 + Math.random() * 0.06); any = true; }
    if (any) scheduleVision();
  }, 140);

  // ---------- Ferramentas ----------
  let tool = 'select';
  let showAllWalls = false;
  const toolOpts = { wallMode: 'wall', lightRadius: 6, lightColor: '#ffb85c', brush: 2, fogMode: 'reveal' };
  const TOOLS = [
    { id: 'select', icon: '🖐', title: 'Selecionar e mover (arraste o mapa para navegar)' },
    { id: 'target', icon: '🎯', title: 'Marcar alvos (ou tecla T sobre o token)' },
    { id: 'ruler', icon: '📏', title: 'Régua de distância' },
    { id: 'ping', icon: '📍', title: 'Chamar atenção para um ponto (ou Alt+clique)' },
    { gm: true, id: 'walls', icon: '🧱', title: 'Paredes e portas' },
    { gm: true, id: 'lights', icon: '💡', title: 'Luzes (lampiões, tochas)' },
    { gm: true, id: 'fog', icon: '🌫', title: 'Névoa de guerra (pintar para revelar)' }
  ];
  const toolsEl = document.getElementById('tools');
  const optsEl = document.getElementById('toolOptions');
  function renderTools() {
    toolsEl.replaceChildren(...TOOLS.filter(t => !t.gm || isGM()).map(t => h('button', { title: t.title, class: tool === t.id ? 'active' : '', onclick: () => setTool(t.id) }, t.icon)),
      h('div.sep'),
      h('button', { title: 'Centralizar no meu token', onclick: centerOnMine }, '⌖'),
      h('button', { title: 'Aproximar', onclick: () => zoomBy(1.25) }, '＋'),
      h('button', { title: 'Afastar', onclick: () => zoomBy(0.8) }, '－'));
    renderToolOptions();
  }
  function zoomBy(f) {
    const cx = pixi.screen.width / 2, cy = pixi.screen.height / 2;
    const before = screenToWorld(cx, cy);
    world.scale.set(Math.max(0.08, Math.min(4, world.scale.x * f)));
    const after = screenToWorld(cx, cy);
    world.position.x += (after.x - before.x) * world.scale.x;
    world.position.y += (after.y - before.y) * world.scale.y;
    saveCameraSoon();
    drawWalls(); drawLightIcons();
  }
  function centerOnMine() {
    for (const t of state.scene?.tokens.values() || []) {
      const a = t.actor_id ? state.actors.get(t.actor_id) : null;
      if (a && (a.owner_id === state.user.id || (isGM() && state.selected.has(t.id)))) { const c = tokenCenter(t); board.centerOn(c.x, c.y); saveCameraSoon(); return; }
    }
    const d = sceneData();
    if (d) board.centerOn(d.width / 2, d.height / 2);
  }
  function setTool(id) {
    tool = id;
    renderTools();
    drawWalls();
    drawLightIcons();
    L.draw.clear();
  }
  function renderToolOptions() {
    const box = [];
    if (tool === 'walls') {
      box.push(h('h4', 'Paredes'),
        h('div.small.muted', 'Arraste para desenhar. Shift: continuar do último ponto. Ctrl: sem encaixe. Botão direito numa parede ou porta: apagar.'),
        h('label.row', h('input', { type: 'radio', name: 'wm', checked: toolOpts.wallMode === 'wall', onchange: () => toolOpts.wallMode = 'wall' }), 'Parede'),
        h('label.row', h('input', { type: 'radio', name: 'wm', checked: toolOpts.wallMode === 'door', onchange: () => toolOpts.wallMode = 'door' }), 'Porta'),
        h('label.row', h('input', { type: 'checkbox', checked: showAllWalls, onchange: (e) => { showAllWalls = e.target.checked; drawWalls(); drawLightIcons(); } }), 'Mostrar paredes sempre'),
        h('button.small', { onclick: async () => { if (await confirmDialog('Apagar paredes', 'Apagar todas as paredes desta cena?', { danger: true })) call('wall:clear'); } }, 'Apagar todas'));
    } else if (tool === 'lights') {
      box.push(h('h4', 'Luzes'),
        h('div.small.muted', 'Clique para acender uma luz. Arraste para mover. Botão direito: editar/apagar.'),
        h('label.row', 'Raio (m)', h('input', { type: 'number', value: toolOpts.lightRadius, step: 0.5, min: 0.5, onchange: (e) => toolOpts.lightRadius = Number(e.target.value) || 6 })),
        h('label.row', 'Cor', h('input', { type: 'color', value: toolOpts.lightColor, onchange: (e) => toolOpts.lightColor = e.target.value })),
        h('div.row', ...[['Vela', 2, '#ffcf7a'], ['Tocha', 4, '#ff9a3c'], ['Lampião', 6, '#ffc36b'], ['Lua', 12, '#9fb7e0']].map(([n, r, c]) => h('button.small', { onclick: () => { toolOpts.lightRadius = r; toolOpts.lightColor = c; renderToolOptions(); } }, n))));
    } else if (tool === 'fog') {
      box.push(h('h4', 'Névoa de guerra'),
        h('div.small.muted', 'Pinte para revelar. Botão direito (ou modo Ocultar) cobre de novo. Shift + arrastar: retângulo.'),
        h('label.row', h('input', { type: 'radio', name: 'fm', checked: toolOpts.fogMode === 'reveal', onchange: () => toolOpts.fogMode = 'reveal' }), 'Revelar'),
        h('label.row', h('input', { type: 'radio', name: 'fm', checked: toolOpts.fogMode === 'hide', onchange: () => toolOpts.fogMode = 'hide' }), 'Ocultar'),
        h('label.row', 'Pincel (quadrados)', h('input', { type: 'range', min: 0.5, max: 8, step: 0.5, value: toolOpts.brush, oninput: (e) => toolOpts.brush = Number(e.target.value) })),
        h('div.row', h('button.small', { onclick: () => call('fog:reset', { mode: 'reveal' }) }, 'Revelar tudo'), h('button.small', { onclick: () => call('fog:reset', { mode: 'hide' }) }, 'Cobrir tudo')));
    } else if (tool === 'ruler') {
      box.push(h('h4', 'Régua'), h('div.small.muted', `Arraste para medir. 1 quadrado = ${sceneData()?.grid.units ?? 1.5} ${sceneData()?.grid.unitName ?? 'm'}.`));
    }
    optsEl.replaceChildren(...box);
    optsEl.classList.toggle('hidden', !box.length);
  }

  // ---------- Entrada no mapa ----------
  let pan = null, ruler = null, wallDraw = null, fogPaint = null, lastWallEnd = null;
  pixi.stage.on('pointerdown', (e) => {
    if (!state.scene) return;
    const p = screenToWorld(e.global.x, e.global.y);
    if (e.button === 1 || e.button === 2) {
      if (tool === 'walls' && e.button === 2 && isGM()) { deleteWallNear(p); return; }
      if (tool === 'fog' && e.button === 2 && isGM()) { fogPaint = { mode: 'hide', last: null }; paintFog(p, e); return; }
      pan = { x: e.global.x, y: e.global.y, ox: world.position.x, oy: world.position.y, moved: false };
      return;
    }
    if (e.altKey || tool === 'ping') { call('map:ping', { x: p.x, y: p.y }, { silent: true }); return; }
    switch (tool) {
      case 'ruler': ruler = { from: centerSnap(p), to: centerSnap(p) }; drawRuler(); return;
      case 'walls': {
        if (!isGM()) return;
        const start = e.shiftKey && lastWallEnd ? lastWallEnd : (e.ctrlKey ? p : { x: snapHalf(p.x), y: snapHalf(p.y) });
        wallDraw = { a: start, b: start };
        return;
      }
      case 'lights':
        if (!isGM()) return;
        call('light:create', { x: p.x, y: p.y, radius: toolOpts.lightRadius, color: toolOpts.lightColor });
        return;
      case 'fog':
        if (!isGM()) return;
        if (e.shiftKey) { fogPaint = { rect: true, a: p, b: p, mode: toolOpts.fogMode }; return; }
        fogPaint = { mode: toolOpts.fogMode, last: null };
        paintFog(p, e);
        return;
      default:
        // Clique no vazio: limpa seleção e começa a arrastar o mapa.
        if (!e.shiftKey && state.selected.size) { state.selected.clear(); emit('selection'); }
        pan = { x: e.global.x, y: e.global.y, ox: world.position.x, oy: world.position.y, moved: false };
    }
  });

  pixi.stage.on('globalpointermove', (e) => {
    const p = screenToWorld(e.global.x, e.global.y);
    if (dragging) {
      const t = dragging.view.token;
      if (!t) return;
      dragging.moved = true;
      dragging.view.root.position.set(p.x - dragging.dx, p.y - dragging.dy);
      return;
    }
    if (lightDrag) { lightDrag.moved = true; lightDrag.view.position.set(p.x, p.y); return; }
    if (pan) {
      pan.moved = true;
      world.position.set(pan.ox + e.global.x - pan.x, pan.oy + e.global.y - pan.y);
      return;
    }
    if (ruler) { ruler.to = centerSnap(p); drawRuler(); return; }
    if (wallDraw) {
      wallDraw.b = e.ctrlKey ? p : { x: snapHalf(p.x), y: snapHalf(p.y) };
      L.draw.clear().moveTo(wallDraw.a.x, wallDraw.a.y).lineTo(wallDraw.b.x, wallDraw.b.y).stroke({ width: 4 / world.scale.x, color: toolOpts.wallMode === 'door' ? 0xb22a2a : 0xd4a017, alpha: 0.8 });
      return;
    }
    if (fogPaint) {
      if (fogPaint.rect) { fogPaint.b = p; const r = rectOf(fogPaint.a, fogPaint.b); L.draw.clear().rect(r.x, r.y, r.w, r.h).stroke({ width: 2 / world.scale.x, color: 0xc9a45c }); }
      else paintFog(p, e);
    }
    if (tool === 'fog' && isGM() && !fogPaint) {
      L.draw.clear().circle(p.x, p.y, toolOpts.brush * gridSize() / 2).stroke({ width: 1.5 / world.scale.x, color: 0xc9a45c, alpha: 0.7 });
    }
  });

  const endPointer = async (e) => {
    if (dragging) { await finishDrag(e); return; }
    if (lightDrag) {
      const ld = lightDrag; lightDrag = null;
      if (ld.moved) call('light:update', { id: ld.id, data: { x: ld.view.x, y: ld.view.y } });
      return;
    }
    if (pan) { if (pan.moved) saveCameraSoon(); pan = null; drawWalls(); drawLightIcons(); return; }
    if (ruler) { ruler = null; L.ruler.removeChildren().forEach(c => c.destroy()); return; }
    if (wallDraw) {
      const w = wallDraw; wallDraw = null;
      L.draw.clear();
      if (Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y) > 4) {
        await call('wall:create', { x1: w.a.x, y1: w.a.y, x2: w.b.x, y2: w.b.y, door: toolOpts.wallMode === 'door' });
        lastWallEnd = w.b;
      }
      return;
    }
    if (fogPaint) {
      const fp = fogPaint; fogPaint = null;
      L.draw.clear();
      if (fp.rect) {
        const r = rectOf(fp.a, fp.b);
        if (r.w > 4 && r.h > 4) call('fog:reveal', { shapes: [{ op: fp.mode, type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h }] });
      } else flushFog();
    }
  };
  pixi.stage.on('pointerup', endPointer);
  pixi.stage.on('pointerupoutside', endPointer);

  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  function centerSnap(p) {
    const g = gridSize();
    return { x: Math.floor(p.x / g) * g + g / 2, y: Math.floor(p.y / g) * g + g / 2 };
  }

  function drawRuler() {
    L.ruler.removeChildren().forEach(c => c.destroy());
    if (!ruler) return;
    const g = new PIXI.Graphics();
    const { from, to } = ruler;
    g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 5 / world.scale.x, color: 0x000000, alpha: 0.7 });
    g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 2.5 / world.scale.x, color: 0xffd27a });
    g.circle(from.x, from.y, 5 / world.scale.x).fill({ color: 0xffd27a }).circle(to.x, to.y, 5 / world.scale.x).fill({ color: 0xffd27a });
    const gs = gridSize();
    const squares = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / gs;
    const units = sceneData().grid.units;
    const meters = Math.round(squares * units * 10) / 10;
    const label = new PIXI.Text({ text: `${meters} ${sceneData().grid.unitName || 'm'}  (${Math.round(squares)} □)`, style: { fontFamily: 'Cinzel, serif', fontSize: 16 / world.scale.x, fill: 0xffffff, stroke: { color: 0x000000, width: 4 / world.scale.x } } });
    label.position.set(to.x + 10 / world.scale.x, to.y - 24 / world.scale.x);
    L.ruler.addChild(g, label);
  }

  // Névoa: acumula pinceladas e envia em lotes.
  let fogBatch = [];
  let fogTimer = null;
  function paintFog(p) {
    const r = (toolOpts.brush * gridSize()) / 2;
    if (fogPaint.last && Math.hypot(p.x - fogPaint.last.x, p.y - fogPaint.last.y) < r * 0.4) return;
    fogPaint.last = p;
    const shape = { op: fogPaint.mode, type: 'circle', x: Math.round(p.x), y: Math.round(p.y), r: Math.round(r) };
    fogBatch.push(shape);
    state.scene.fog.shapes.push(shape); // prévia imediata
    renderFog();
    clearTimeout(fogTimer);
    fogTimer = setTimeout(flushFog, 250);
  }
  function flushFog() {
    if (!fogBatch.length) return;
    const shapes = fogBatch; fogBatch = [];
    // Remove a prévia local (o servidor devolve oficialmente via fog:add).
    state.scene.fog.shapes = state.scene.fog.shapes.filter(s => !shapes.includes(s));
    call('fog:reveal', { shapes });
  }

  function deleteWallNear(p) {
    let best = null, bestD = 12 / world.scale.x;
    for (const w of state.scene.walls.values()) {
      const d = distToSeg(p, { x: w.data.x1, y: w.data.y1 }, { x: w.data.x2, y: w.data.y2 });
      if (d < bestD) { bestD = d; best = w; }
    }
    if (best) call('wall:delete', { id: best.id });
  }
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  // ---------- Ping ----------
  on('ping', (p) => {
    const c = new PIXI.Container();
    const g = new PIXI.Graphics();
    const color = parseInt((p.color || '#c9a45c').slice(1), 16);
    const label = new PIXI.Text({ text: p.name, style: { fontFamily: 'Cinzel, serif', fontSize: 14 / world.scale.x, fill: color, stroke: { color: 0, width: 3 / world.scale.x } } });
    label.anchor.set(0.5, 1.6);
    c.addChild(g, label);
    c.position.set(p.x, p.y);
    L.pings.addChild(c);
    const t0 = performance.now();
    const tick = () => {
      const k = (performance.now() - t0) / 1600;
      if (k >= 1 || c.destroyed) { pixi.ticker.remove(tick); if (!c.destroyed) c.destroy({ children: true }); return; }
      g.clear();
      for (let i = 0; i < 3; i++) {
        const kk = (k + i * 0.25) % 1;
        g.circle(0, 0, (10 + kk * gridSize() * 1.2) / Math.max(0.5, world.scale.x) * Math.min(1, world.scale.x)).stroke({ width: 3 / world.scale.x, color, alpha: 1 - kk });
      }
    };
    pixi.ticker.add(tick);
  });
  on('pan', (p) => { board.centerOn(p.x, p.y); saveCameraSoon(); });

  // ---------- Teclado ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 't' && hoverToken) { toggleTarget(hoverToken); e.preventDefault(); }
    else if (k === 'escape') { state.targets.clear(); state.selected.clear(); emit('targets'); emit('selection'); }
    else if ((k === 'delete' || k === 'backspace') && isGM() && state.selected.size) {
      for (const id of state.selected) call('token:delete', { id });
    } else if (k.startsWith('arrow') && state.selected.size) {
      e.preventDefault();
      const g = gridSize();
      const [dx, dy] = { arrowup: [0, -g], arrowdown: [0, g], arrowleft: [-g, 0], arrowright: [g, 0] }[k] || [0, 0];
      for (const id of state.selected) {
        const t = state.scene?.tokens.get(id);
        if (t) call('token:move', { id, x: t.data.x + dx, y: t.data.y + dy });
      }
    }
  });

  // ---------- Arrastar da barra lateral para o mapa ----------
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('application/x-questvtt') || e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!state.scene) { toast('Abra uma cena primeiro.', 'error'); return; }
    const rect = el.getBoundingClientRect();
    const p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (data.type === 'actor') await call('token:create', { actorId: data.id, x: p.x - gridSize() / 2, y: p.y - gridSize() / 2 });
    else if (data.type === 'compendium' && isGM()) {
      if (['bestiary', 'ascendants'].includes(data.pack)) await call('actor:spawn', { pack: data.pack, ref: data.id, x: p.x, y: p.y, hidden: e.altKey });
      else toast('Arraste este item para uma ficha, não para o mapa.', 'info');
    }
  });

  // ---------- Reações a mudanças de estado ----------
  on('world:reset', () => { renderTools(); loadScene(); });
  on('scene', () => loadScene());
  on('scene:config', () => { loadScene(); });
  on('scenes', () => updateBadge());
  on('token', (t) => { upsertToken(t); scheduleVision(); });
  on('token:delete', (id) => { removeToken(id); scheduleVision(); });
  on('walls', () => { vision.invalidate(); drawWalls(); scheduleVision(); });
  on('lights', () => { drawLightIcons(); scheduleVision(); });
  on('fog', () => renderFog());
  on('actors', () => { for (const v of tokenViews.values()) v.refresh(); scheduleVision(); });
  on('combat', () => { for (const v of tokenViews.values()) v.refresh(); });
  on('selection', () => { for (const v of tokenViews.values()) v.refresh(); });
  on('targets', () => { for (const v of tokenViews.values()) v.refresh(); });
  on('system', () => { for (const v of tokenViews.values()) v.refresh(); });
  window.addEventListener('resize', () => { if (!state.scene) emptyText.position.set(pixi.screen.width / 2, pixi.screen.height / 2); });

  renderTools();
  return board;
}
