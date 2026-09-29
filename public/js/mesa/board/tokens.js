// Desenho de um token no mapa: retrato, moldura, barras, ícones de estado, nome e alvos.
import * as PIXI from '/vendor/pixi/pixi.min.mjs';
import { state, isGM } from '../state.js';

const DISPOSITION_COLORS = { hunter: 0xc9a45c, creature: 0x8b1a1a, neutral: 0x8a7b66, corpse: 0x3a2a22 };
const textureCache = new Map();

async function loadTexture(url) {
  if (!url) return null;
  if (textureCache.has(url)) return textureCache.get(url);
  const p = PIXI.Assets.load(url).catch(() => null);
  textureCache.set(url, p);
  return p;
}

export class TokenView {
  constructor(board, token) {
    this.board = board;
    this.id = token.id;
    this.root = new PIXI.Container();
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    this.body = new PIXI.Container();
    this.frame = new PIXI.Graphics();
    this.art = new PIXI.Container();
    this.overlay = new PIXI.Graphics();
    this.bars = new PIXI.Graphics();
    this.select = new PIXI.Graphics();
    this.target = new PIXI.Graphics();
    this.active = new PIXI.Graphics();
    this.icons = new PIXI.Text({ text: '', style: { fontSize: 16, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
    this.label = new PIXI.Text({ text: '', style: { fontFamily: 'Cinzel, serif', fontSize: 14, fill: 0xe8dcc0, stroke: { color: 0x000000, width: 4 }, align: 'center' } });
    this.label.anchor.set(0.5, 0);
    this.body.addChild(this.frame, this.art, this.overlay);
    this.root.addChild(this.active, this.body, this.select, this.target, this.bars, this.icons, this.label);
    this.hover = false;
    this.root.on('pointerover', () => { this.hover = true; this.refreshLabel(); });
    this.root.on('pointerout', () => { this.hover = false; this.refreshLabel(); });
    this.imgUrl = undefined;
    this.update(token);
  }

  get token() { return state.scene?.tokens.get(this.id); }
  get actor() { const t = this.token; return t && t.actor_id ? state.actors.get(t.actor_id) : null; }

  async update(token) {
    const gs = this.board.gridSize();
    const size = gs * (token.data.size || 1);
    this.size = size;
    if (!this.dragging) this.root.position.set(token.data.x, token.data.y);
    const color = DISPOSITION_COLORS[token.data.disposition] ?? DISPOSITION_COLORS.neutral;

    this.frame.clear();
    this.frame.roundRect(0, 0, size, size, size * 0.12).fill({ color: 0x0b0908, alpha: 0.85 }).stroke({ width: Math.max(2, size * 0.04), color, alpha: 1 });

    const url = token.data.img || null;
    if (url !== this.imgUrl) {
      this.imgUrl = url;
      this.art.removeChildren().forEach(c => c.destroy());
      if (url) {
        const tex = await loadTexture(url);
        if (tex && this.imgUrl === url && !this.root.destroyed) {
          const sp = new PIXI.Sprite(tex);
          const k = Math.min((size * 0.92) / tex.width, (size * 0.92) / tex.height);
          sp.scale.set(k);
          sp.position.set((size - tex.width * k) / 2, (size - tex.height * k) / 2);
          this.art.addChild(sp);
        }
      }
      if (!url || !this.art.children.length) this.drawInitials(token, size, color);
    } else if (this.art.children[0] instanceof PIXI.Sprite) {
      const sp = this.art.children[0];
      const tex = sp.texture;
      const k = Math.min((size * 0.92) / tex.width, (size * 0.92) / tex.height);
      sp.scale.set(k);
      sp.position.set((size - tex.width * k) / 2, (size - tex.height * k) / 2);
    } else {
      this.drawInitials(token, size, color);
    }

    // Rotação do corpo (cadáveres ficam deitados)
    this.body.pivot.set(size / 2, size / 2);
    this.body.position.set(size / 2, size / 2);
    this.body.rotation = ((token.data.rotation || 0) * Math.PI) / 180;
    this.body.alpha = token.data.hidden ? 0.45 : 1;
    this.refresh();
  }

  drawInitials(token, size, color) {
    this.art.removeChildren().forEach(c => c.destroy());
    const g = new PIXI.Graphics();
    g.circle(size / 2, size / 2, size * 0.36).fill({ color: 0x1d1712 }).stroke({ width: 2, color, alpha: 0.8 });
    const initials = (token.data.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const t = new PIXI.Text({ text: token.data.disposition === 'corpse' ? '✝' : initials, style: { fontFamily: 'Cinzel, serif', fontSize: size * 0.3, fill: 0xc9a45c } });
    t.anchor.set(0.5);
    t.position.set(size / 2, size / 2);
    this.art.addChild(g, t);
  }

  // Barras, estados, seleção, alvo, destaque de combate.
  refresh() {
    const token = this.token;
    if (!token) return;
    const size = this.size;
    const actor = this.actor;
    const info = actor && this.board.app.system?.tokenInfo ? this.board.app.system.tokenInfo(actor, token) : null;

    // Barras
    this.bars.clear();
    const bars = info?.bars || [];
    bars.forEach((b, i) => {
      if (b.max == null || b.value == null) return;
      const y = size + 3 + i * 7;
      const pct = Math.max(0, Math.min(1, b.max ? b.value / b.max : 0));
      this.bars.roundRect(2, y, size - 4, 5, 2).fill({ color: 0x000000, alpha: 0.75 });
      this.bars.roundRect(2, y, (size - 4) * pct, 5, 2).fill({ color: b.color ?? 0xb22a2a });
    });
    // Ícones de estado
    this.icons.text = (info?.icons || []).join('');
    this.icons.style.fontSize = Math.max(11, size * 0.22);
    this.icons.position.set(2, -this.icons.height * 0.2);
    // Sobreposição (abatido / morrendo)
    this.overlay.clear();
    if (info?.defeated) {
      this.overlay.moveTo(size * 0.15, size * 0.15).lineTo(size * 0.85, size * 0.85).moveTo(size * 0.85, size * 0.15).lineTo(size * 0.15, size * 0.85).stroke({ width: size * 0.08, color: 0x8b1a1a, alpha: 0.9 });
    }
    this.art.alpha = info?.defeated ? 0.45 : 1;
    // Seleção
    this.select.clear();
    if (state.selected.has(this.id)) this.select.roundRect(-3, -3, size + 6, size + 6, size * 0.14).stroke({ width: 3, color: 0xffd27a, alpha: 0.95 });
    // Alvo (mira na cor do usuário)
    this.target.clear();
    if (state.targets.has(this.id)) {
      const c = parseInt((state.user?.color || '#d33a3a').slice(1), 16);
      const m = size * 0.22;
      for (const [x, y, dx, dy] of [[0, 0, 1, 1], [size, 0, -1, 1], [0, size, 1, -1], [size, size, -1, -1]]) {
        this.target.moveTo(x, y + dy * m).lineTo(x, y).lineTo(x + dx * m, y).stroke({ width: 4, color: c });
      }
    }
    // Destaque do combatente ativo
    this.active.clear();
    const cb = state.combat?.combatants?.find(c => c.token_id === this.id);
    if (cb && state.combat.data.activeCombatantId === cb.id) {
      this.active.circle(size / 2, size / 2, size * 0.72).fill({ color: 0xc9a45c, alpha: 0.18 }).stroke({ width: 3, color: 0xc9a45c, alpha: 0.8 });
    }
    this.refreshLabel();
  }

  refreshLabel() {
    const token = this.token;
    if (!token) return;
    const mode = token.data.showName || 'hover';
    const show = mode === 'all' || (mode === 'hover' && (this.hover || state.selected.has(this.id))) || (mode === 'gm' && isGM() && this.hover) || isGM() && this.hover;
    let text = token.data.name || '';
    if (token.data.disposition === 'corpse' && token.data.ecos != null) text += `\n🩸 ${token.data.ecos} Ecos`;
    this.label.text = text;
    this.label.visible = show || token.data.disposition === 'corpse';
    this.label.style.fontSize = Math.max(11, Math.min(18, this.size * 0.2));
    const barsH = 3 + ((this.board.app.system?.tokenInfo && this.actor) ? (this.board.app.system.tokenInfo(this.actor, token)?.bars?.length || 0) * 7 : 0);
    this.label.position.set(this.size / 2, this.size + barsH + 2);
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
