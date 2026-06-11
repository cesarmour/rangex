// Registro de tipos de alvo. A geometria de cada tipo e expressa em relacao a um
// QUADRO (frame): agora um QUADRILATERO de 4 cantos livres sobre a foto, em
// fracoes 0..1 da imagem ({tl,tr,bl,br}, cada um {x,y}). Cantos livres + mapeamento
// bilinear permitem encaixar alvos empenados/em perspectiva: cada padrao tem seu
// centro interpolado dentro do quadrilatero, entao ajustar um canto NAO desalinha
// os outros padroes.
//
// Saida de calibracao na convencao que scoring.js consome:
//   - centro: x = fracao 0..1 da LARGURA, y = fracao 0..1 da ALTURA da imagem
//   - raios: fracao 0..1 da LARGURA da imagem

export const RING_RATIOS = { bull: 0.10, r5: 0.50, r4: 0.75, r3: 1.0 }

// mode:
//   'concentric' -> pontuacao por aneis (scoring.js). patterns: posicao (u,v) de
//                   cada mosca dentro do quadro; ring3OfFrameWidth = raio externo.
//   'count'      -> sem tabela de zonas ainda: detecta/marca e CONTA os furos.
//                   pontuacao por zonas requer as medidas oficiais do alvo.
export const TARGETS = {
  fc4: {
    id: 'fc4',
    label: 'Fogo Central 4 Cores',
    mode: 'concentric',
    patterns: [
      { id: 'amarelo', u: 0.25, v: 0.25 },
      { id: 'verde', u: 0.75, v: 0.25 },
      { id: 'vermelho', u: 0.25, v: 0.75 },
      { id: 'azul', u: 0.75, v: 0.75 },
    ],
    ring3OfFrameWidth: 0.2244,
  },
  single: {
    id: 'single',
    label: 'Mosca unica',
    mode: 'concentric',
    patterns: [{ id: 'amarelo', u: 0.5, v: 0.5 }],
    ring3OfFrameWidth: 0.5,
  },
  humanoide: {
    id: 'humanoide',
    label: 'Silhueta humanoide',
    mode: 'count',
    patterns: [{ id: 'amarelo', u: 0.5, v: 0.45 }],
  },
  refem: {
    id: 'refem',
    label: 'Refem (hostage)',
    mode: 'count',
    patterns: [{ id: 'amarelo', u: 0.5, v: 0.45 }],
  },
  ombreira: {
    id: 'ombreira',
    label: 'Ombreira / silhueta',
    mode: 'count',
    patterns: [{ id: 'amarelo', u: 0.5, v: 0.5 }],
  },
}

export const DEFAULT_TARGET = 'fc4'
export const QUADRANT_KEYS = ['amarelo', 'verde', 'vermelho', 'azul']

export function getTarget(id) {
  return TARGETS[id] || TARGETS[DEFAULT_TARGET]
}
export function targetList() {
  return Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label, mode: t.mode }))
}

export const DEFAULT_FRAME = {
  tl: { x: 0.05, y: 0.05 }, tr: { x: 0.95, y: 0.05 },
  bl: { x: 0.05, y: 0.95 }, br: { x: 0.95, y: 0.95 },
}

function clamp01(v) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0
  return Math.max(0, Math.min(1, n))
}
// Cantos do quadro podem cair FORA da foto (foto sem borda, alvo cortado).
// O detector recorta a varredura pra dentro da imagem, e a pontuacao e geometria
// pura, entao extrapolar e seguro. Limite de seguranca de meia imagem pra cada lado.
const FRAME_EXT = 0.5
function clampExt(v) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0
  return Math.max(-FRAME_EXT, Math.min(1 + FRAME_EXT, n))
}
function clampPt(p) { return { x: clampExt(p.x), y: clampExt(p.y) } }

// Aceita quadrilatero {tl,tr,bl,br} OU retangulo legado {x0,y0,x1,y1} OU nulo.
export function frameToQuad(frame) {
  if (frame && frame.tl && frame.tr && frame.bl && frame.br) {
    return { tl: clampPt(frame.tl), tr: clampPt(frame.tr), bl: clampPt(frame.bl), br: clampPt(frame.br) }
  }
  if (frame && typeof frame.x0 === 'number') {
    const x0 = clamp01(frame.x0), y0 = clamp01(frame.y0), x1 = clamp01(frame.x1), y1 = clamp01(frame.y1)
    return { tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, bl: { x: x0, y: y1 }, br: { x: x1, y: y1 } }
  }
  return { ...DEFAULT_FRAME }
}

// Garante quadro nao-degenerado (cantos no [0,1] e extensao minima).
export function normalizeFrame(frame) {
  const q = frameToQuad(frame)
  const xs = [q.tl.x, q.tr.x, q.bl.x, q.br.x]
  const ys = [q.tl.y, q.tr.y, q.bl.y, q.br.y]
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  const MIN = 0.08
  if (w >= MIN && h >= MIN) return q
  // se colapsou, expande de volta pro quadro padrao
  return { ...DEFAULT_FRAME }
}

function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }
// Ponto bilinear dentro do quadrilatero, (u,v) em [0,1].
export function bilinear(quad, u, v) {
  const top = lerp(quad.tl, quad.tr, u)
  const bot = lerp(quad.bl, quad.br, u)
  return lerp(top, bot, v)
}

// Largura efetiva do quadro (fracao da largura da imagem) = media das arestas
// horizontais. Base pro raio dos aneis.
export function quadWidth(quad) {
  const top = Math.abs(quad.tr.x - quad.tl.x)
  const bot = Math.abs(quad.br.x - quad.bl.x)
  return Math.max(1e-4, (top + bot) / 2)
}

// Bounding box do quadro (fracoes 0..1).
export function quadBBox(quad) {
  return {
    x0: Math.min(quad.tl.x, quad.tr.x, quad.bl.x, quad.br.x),
    y0: Math.min(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y),
    x1: Math.max(quad.tl.x, quad.tr.x, quad.bl.x, quad.br.x),
    y1: Math.max(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y),
  }
}

// Ponto dentro do quadrilatero (ordem tl,tr,br,bl).
export function pointInQuad(quad, x, y) {
  const poly = [quad.tl, quad.tr, quad.br, quad.bl]
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)
    if (hit) inside = !inside
  }
  return inside
}

// Constroi a calibracao por quadrante que scoring.js consome, a partir do quadro
// + tipo de alvo. Centros via bilinear; raios pela largura efetiva do quadro.
export function calibrationFromFrame(frame, targetId) {
  const t = getTarget(targetId)
  const quad = frameToQuad(frame)
  const fw = quadWidth(quad)
  const ring3 = (t.ring3OfFrameWidth || 0) * fw
  const radii = {
    r3: ring3,
    r4: ring3 * RING_RATIOS.r4,
    r5: ring3 * RING_RATIOS.r5,
    bull: ring3 * RING_RATIOS.bull,
  }
  const placed = {}
  for (const p of t.patterns) {
    const c = bilinear(quad, p.u, p.v)
    placed[p.id] = {
      bull_center: { x: c.x, y: c.y },
      ring3_radius: radii.r3,
      ring4_radius: radii.r4,
      ring5_radius: radii.r5,
      radii,
    }
  }
  const firstCenter = placed[t.patterns[0].id].bull_center
  const quadrants = {}
  for (const k of QUADRANT_KEYS) {
    quadrants[k] = placed[k] || {
      bull_center: { x: firstCenter.x, y: firstCenter.y },
      ring3_radius: radii.r3, ring4_radius: radii.r4, ring5_radius: radii.r5, radii,
    }
  }
  return { quadrants }
}

// Resolve os 4 cantos do quadro a partir dos centros de mosca desejados.
// Inverte o mapeamento bilinear: cada centro e combinacao linear dos cantos com
// pesos (1-u)(1-v), u(1-v), (1-u)v, uv. Com 4 padroes o sistema e exato (4x4).
// E o que permite alinhar as moscas quando a foto nao tem borda: o canto
// correspondente cai fora da imagem e tudo bem. Retorna null se nao resolver
// (padroes != 4 ou sistema degenerado).
export function quadFromCenters(patterns, centers) {
  if (!patterns || patterns.length !== 4) return null
  const M = patterns.map((p) => {
    const u = p.u, v = p.v
    return [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v]
  })
  const bx = patterns.map((p) => centers[p.id] && centers[p.id].x)
  const by = patterns.map((p) => centers[p.id] && centers[p.id].y)
  if (bx.some((n) => typeof n !== 'number' || !isFinite(n))) return null
  if (by.some((n) => typeof n !== 'number' || !isFinite(n))) return null
  const sx = solve4(M, bx)
  const sy = solve4(M, by)
  if (!sx || !sy) return null
  return {
    tl: { x: sx[0], y: sy[0] }, tr: { x: sx[1], y: sy[1] },
    bl: { x: sx[2], y: sy[2] }, br: { x: sx[3], y: sy[3] },
  }
}

// Eliminacao de Gauss-Jordan 4x4 com pivoteamento parcial.
function solve4(Min, bin) {
  const A = Min.map((row, i) => [...row, bin[i]])
  for (let c = 0; c < 4; c++) {
    let piv = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-9) return null
    const tmp = A[c]; A[c] = A[piv]; A[piv] = tmp
    for (let r = 0; r < 4; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k <= 4; k++) A[r][k] -= f * A[c][k]
    }
  }
  return [A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2], A[3][4] / A[3][3]]
}
