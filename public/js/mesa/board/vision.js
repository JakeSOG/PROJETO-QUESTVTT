// Visão e luz: polígonos de visibilidade (raycasting contra paredes) desenhados
// em canvas 2D de baixa resolução, depois usados como textura no PixiJS.

// Paredes que bloqueiam a visão (portas abertas não bloqueiam).
export function blockingSegments(walls) {
  const segs = [];
  for (const w of walls) {
    const d = w.data;
    if (d.door && d.open) continue;
    if (d.x1 === d.x2 && d.y1 === d.y2) continue;
    segs.push({ a: { x: d.x1, y: d.y1 }, b: { x: d.x2, y: d.y2 } });
  }
  return segs;
}

// Interseção de um raio (origem o, direção dx,dy) com um segmento. Retorna t (distância paramétrica) ou null.
function raySegment(o, dx, dy, s) {
  const sx = s.b.x - s.a.x, sy = s.b.y - s.a.y;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((s.a.x - o.x) * sy - (s.a.y - o.y) * sx) / den;
  const u = ((s.a.x - o.x) * dy - (s.a.y - o.y) * dx) / den;
  if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
}

// Polígono de visibilidade a partir de "origin", limitado por um retângulo "bounds".
export function visibilityPolygon(origin, segments, bounds) {
  const { x0, y0, x1, y1 } = bounds;
  const box = [
    { a: { x: x0, y: y0 }, b: { x: x1, y: y0 } },
    { a: { x: x1, y: y0 }, b: { x: x1, y: y1 } },
    { a: { x: x1, y: y1 }, b: { x: x0, y: y1 } },
    { a: { x: x0, y: y1 }, b: { x: x0, y: y0 } }
  ];
  // Só considera paredes que tocam a área (otimização).
  const inside = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const relevant = segments.filter(s => inside(s.a) || inside(s.b) || segBoxCross(s, bounds));
  const all = [...relevant, ...box];
  const angles = [];
  for (const s of all) {
    for (const p of [s.a, s.b]) {
      const ang = Math.atan2(p.y - origin.y, p.x - origin.x);
      angles.push(ang - 0.00005, ang, ang + 0.00005);
    }
  }
  const pts = [];
  for (const ang of angles) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let best = Infinity;
    for (const s of all) {
      const t = raySegment(origin, dx, dy, s);
      if (t !== null && t < best) best = t;
    }
    if (best < Infinity) pts.push({ ang, x: origin.x + dx * best, y: origin.y + dy * best });
  }
  pts.sort((a, b) => a.ang - b.ang);
  return pts;
}

function segBoxCross(s, b) {
  const minx = Math.min(s.a.x, s.b.x), maxx = Math.max(s.a.x, s.b.x);
  const miny = Math.min(s.a.y, s.b.y), maxy = Math.max(s.a.y, s.b.y);
  return !(maxx < b.x0 || minx > b.x1 || maxy < b.y0 || miny > b.y1);
}

// Gerencia os canvases de escuridão, luz colorida e névoa.
export class VisionRenderer {
  constructor() {
    this.dark = document.createElement('canvas');
    this.light = document.createElement('canvas');
    this.color = document.createElement('canvas');
    this.fog = document.createElement('canvas');
    this.cache = new Map();
    this.scale = 0.25;
    this.visibleData = null;
    this.fogData = null;
  }

  resize(width, height) {
    // Mantém os canvases com no máximo ~1600 px no maior lado.
    this.scale = Math.min(0.5, 1600 / Math.max(width, height));
    const w = Math.max(1, Math.ceil(width * this.scale));
    const hgt = Math.max(1, Math.ceil(height * this.scale));
    for (const c of [this.dark, this.light, this.color, this.fog]) { c.width = w; c.height = hgt; }
    this.width = width; this.height = height;
    this.cache.clear();
  }

  invalidate() { this.cache.clear(); }

  polygonFor(key, origin, segments, bounds) {
    const k = `${key}|${origin.x}|${origin.y}|${bounds.x0}|${bounds.y0}|${bounds.x1}|${bounds.y1}`;
    if (!this.cache.has(k)) this.cache.set(k, visibilityPolygon(origin, segments, bounds));
    return this.cache.get(k);
  }

  // sources: { lights: [{x,y,r,dim,color,flick}], eyes: [{x,y,range}], personal: [{x,y,r}] }
  // opts: { darkness: 0..1, clipToEyes: bool, enabled: bool }
  render(segments, sources, opts) {
    const s = this.scale;
    const W = this.dark.width, H = this.dark.height;
    const dctx = this.dark.getContext('2d');
    const lctx = this.light.getContext('2d', { willReadFrequently: true });
    const cctx = this.color.getContext('2d');
    dctx.setTransform(1, 0, 0, 1, 0, 0); dctx.clearRect(0, 0, W, H);
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, W, H);
    cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, W, H);
    this.visibleData = null;
    if (!opts.enabled) return;

    const sceneBounds = { x0: 0, y0: 0, x1: this.width, y1: this.height };
    lctx.setTransform(s, 0, 0, s, 0, 0);
    cctx.setTransform(s, 0, 0, s, 0, 0);

    const drawSource = (src, key, colorful) => {
      const r = src.r * (src.flick || 1);
      const bounds = { x0: Math.max(0, src.x - src.r * 1.1), y0: Math.max(0, src.y - src.r * 1.1), x1: Math.min(this.width, src.x + src.r * 1.1), y1: Math.min(this.height, src.y + src.r * 1.1) };
      const poly = this.polygonFor(key, { x: src.x, y: src.y }, segments, bounds);
      if (poly.length < 3) return;
      const path = new Path2D();
      path.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) path.lineTo(poly[i].x, poly[i].y);
      path.closePath();
      const g = lctx.createRadialGradient(src.x, src.y, 0, src.x, src.y, Math.max(1, r));
      const bright = Math.max(0, Math.min(0.95, src.dim ?? 0.55));
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(bright, 'rgba(255,255,255,0.92)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      lctx.fillStyle = g;
      lctx.fill(path);
      if (colorful && src.color) {
        const cg = cctx.createRadialGradient(src.x, src.y, 0, src.x, src.y, Math.max(1, r));
        cg.addColorStop(0, hexA(src.color, 0.55));
        cg.addColorStop(1, hexA(src.color, 0));
        cctx.fillStyle = cg;
        cctx.fill(path);
      }
    };

    sources.lights.forEach((l, i) => drawSource(l, `L${l.id ?? i}`, true));
    sources.personal.forEach((p, i) => drawSource({ ...p, dim: 0.3 }, `P${p.id ?? i}`, false));

    // Recorta pela linha de visão dos tokens do jogador.
    if (opts.clipToEyes) {
      const eyes = new Path2D();
      for (const e of sources.eyes) {
        const b = e.range ? { x0: Math.max(0, e.x - e.range), y0: Math.max(0, e.y - e.range), x1: Math.min(this.width, e.x + e.range), y1: Math.min(this.height, e.y + e.range) } : sceneBounds;
        const poly = this.polygonFor(`E${e.id}`, { x: e.x, y: e.y }, segments, b);
        if (poly.length < 3) continue;
        eyes.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) eyes.lineTo(poly[i].x, poly[i].y);
        eyes.closePath();
      }
      lctx.globalCompositeOperation = 'destination-in';
      lctx.fillStyle = '#fff';
      lctx.fill(eyes);
      lctx.globalCompositeOperation = 'source-over';
      cctx.globalCompositeOperation = 'destination-in';
      cctx.fillStyle = '#fff';
      cctx.fill(eyes);
      cctx.globalCompositeOperation = 'source-over';
    }

    dctx.fillStyle = `rgba(0,0,0,${opts.darkness})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    dctx.drawImage(this.light, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    this.visibleData = opts.clipToEyes ? lctx.getImageData(0, 0, W, H) : null;
  }

  // Névoa: shapes em ordem (revelar = apaga, ocultar = pinta).
  renderFog(shapes, enabled) {
    const s = this.scale;
    const ctx = this.fog.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fog.width, this.fog.height);
    this.fogData = null;
    if (!enabled) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.fog.width, this.fog.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    for (const sh of shapes || []) {
      ctx.globalCompositeOperation = sh.op === 'hide' ? 'source-over' : 'destination-out';
      ctx.fillStyle = '#000';
      ctx.beginPath();
      if (sh.type === 'rect') ctx.rect(sh.x, sh.y, sh.w, sh.h);
      else if (sh.type === 'poly' && sh.points?.length >= 6) {
        ctx.moveTo(sh.points[0], sh.points[1]);
        for (let i = 2; i < sh.points.length; i += 2) ctx.lineTo(sh.points[i], sh.points[i + 1]);
        ctx.closePath();
      } else ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    this.fogData = ctx.getImageData(0, 0, this.fog.width, this.fog.height);
  }

  // Um ponto do mapa está visível para o jogador?
  isVisible(x, y) {
    const s = this.scale;
    const px = Math.floor(x * s), py = Math.floor(y * s);
    if (this.fogData) {
      const i = (py * this.fog.width + px) * 4 + 3;
      if (px >= 0 && py >= 0 && px < this.fog.width && py < this.fog.height && this.fogData.data[i] > 200) return false;
    }
    if (this.visibleData) {
      if (px < 0 || py < 0 || px >= this.light.width || py >= this.light.height) return false;
      const i = (py * this.light.width + px) * 4 + 3;
      return this.visibleData.data[i] > 25;
    }
    return true;
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
