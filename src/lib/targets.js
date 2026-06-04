// Registro de tipos de alvo. A geometria de cada tipo e expressa em relacao a um
// QUADRO (frame): um retangulo sobre a foto, em fracoes 0..1 da imagem
// ({x0,y0,x1,y1}). O quadro e o que o atirador ajusta. A partir dele derivamos,
// de forma deterministica, o centro da mosca e os raios dos aneis de cada padrao,
// na mesma convencao que scoring.js consome:
//   - centro: x = fracao 0..1 da LARGURA, y = fracao 0..1 da ALTURA da imagem
//   - raios: fracao 0..1 da LARGURA da imagem
//
// Isso substitui o bbox auto-detectado fragil: em vez de adivinhar a area do
// alvo a partir de pixels saturados (que lavam com reflexo no topo), a area vem
// do quadro semeado pela deteccao e corrigivel pelo atirador.

// Proporcoes dos aneis relativas ao anel externo (anel 3 = 1.0). Medidas do PDF
// oficial "Alvo Fogo Central 4 Cores SAT/ANP" (Portaria 7508/2017): da mosca,
// zona 5 = 5.34cm, zona 4 = 8.06cm, zona 3 = 10.77cm, mosca = 1.07cm.
export const RING_RATIOS = { bull: 0.10, r5: 0.50, r4: 0.75, r3: 1.0 }

export const TARGETS = {
  // Fogo Central 4 Cores: 4 padroes, um por quadrante. Cada padrao tem anel
  // externo de 10.77cm num alvo de 48cm de largura -> 0.2244 da largura.
  fc4: {
    id: 'fc4',
    label: 'Fogo Central 4 Cores',
    patterns: [
      { id: 'amarelo', cxFrac: 0.25, cyFrac: 0.25 },
      { id: 'verde', cxFrac: 0.75, cyFrac: 0.25 },
      { id: 'vermelho', cxFrac: 0.25, cyFrac: 0.75 },
      { id: 'azul', cxFrac: 0.75, cyFrac: 0.75 },
    ],
    ring3OfFrameWidth: 0.2244,
  },
  // Mosca unica: um padrao concentrico. O quadro e posto sobre o anel EXTERNO,
  // entao o raio externo = metade da largura do quadro (auto-calibrado, sem
  // depender de um modelo fixo de alvo).
  single: {
    id: 'single',
    label: 'Mosca unica',
    patterns: [
      { id: 'amarelo', cxFrac: 0.5, cyFrac: 0.5 },
    ],
    ring3OfFrameWidth: 0.5,
  },
}

export const DEFAULT_TARGET = 'fc4'

// Chaves do container de saida (mantidas estaveis pra nao quebrar PDF/stats/duelo
// que ainda assumem 4 quadrantes nomeados).
export const QUADRANT_KEYS = ['amarelo', 'verde', 'vermelho', 'azul']

export function getTarget(id) {
  return TARGETS[id] || TARGETS[DEFAULT_TARGET]
}

export function targetList() {
  return Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label }))
}

// Quadro padrao: a imagem quase inteira (o atirador ajusta). Fracoes da imagem.
export const DEFAULT_FRAME = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 }

export function normalizeFrame(frame) {
  const f = frame || DEFAULT_FRAME
  let x0 = clamp01(f.x0), y0 = clamp01(f.y0), x1 = clamp01(f.x1), y1 = clamp01(f.y1)
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  const MIN = 0.08
  if (x1 - x0 < MIN) x1 = Math.min(1, x0 + MIN)
  if (y1 - y0 < MIN) y1 = Math.min(1, y0 + MIN)
  return { x0, y0, x1, y1 }
}

function clamp01(v) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0
  return Math.max(0, Math.min(1, n))
}

// Constroi a calibracao por quadrante que scoring.js consome, a partir do
// quadro + tipo de alvo. Para tipos com menos de 4 padroes, as chaves restantes
// herdam o centro do primeiro padrao (centros iguais => scoring atribui tudo a
// um quadrante; totais ficam corretos).
export function calibrationFromFrame(frame, targetId) {
  const t = getTarget(targetId)
  const f = normalizeFrame(frame)
  const fw = f.x1 - f.x0
  const fh = f.y1 - f.y0
  const r3 = t.ring3OfFrameWidth * fw // fracao da LARGURA da imagem
  const radii = {
    r3,
    r4: r3 * RING_RATIOS.r4,
    r5: r3 * RING_RATIOS.r5,
    bull: r3 * RING_RATIOS.bull,
  }

  const placed = {}
  for (const p of t.patterns) {
    placed[p.id] = {
      bull_center: { x: f.x0 + p.cxFrac * fw, y: f.y0 + p.cyFrac * fh },
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
      ring3_radius: radii.r3,
      ring4_radius: radii.r4,
      ring5_radius: radii.r5,
      radii,
    }
  }
  return { quadrants }
}
