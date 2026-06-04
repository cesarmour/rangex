// Deterministic scoring from hole coordinates + per-quadrant calibration.
//
// Division of labor (first principles):
//   - Vision (analyze-target.js) measures the BIG, high-contrast features it is
//     reliable at: each quadrant's bull (mosca) center and the printed ring radii,
//     plus a flat list of hole coordinates.
//   - This file does the math: assign each hole to a quadrant, measure its distance
//     to that quadrant's REAL bull center, classify against that quadrant's REAL
//     ring radii, sum points. No fixed-position or fixed-zoom assumptions.
//
// Coordinate convention:
//   - x is a fraction 0..1 of image WIDTH, y is a fraction 0..1 of image HEIGHT
//     (this is what the overlay renders with: x*imgW, y*imgH).
//   - Ring radii are fractions of image WIDTH.
//   - For ISOTROPIC distance, y is converted to width units internally using the
//     image aspect (W/H). Without aspect, it degrades to square (no crash).

const QUADRANT_NAMES = ['amarelo', 'verde', 'vermelho', 'azul']

// Fallback bull centers (image quarters), used ONLY when vision returned no
// calibration, kept so a malformed detection response cannot crash scoring.
const DEFAULT_BULL_CENTERS = {
  amarelo:  { x: 0.25, y: 0.25 },
  verde:    { x: 0.75, y: 0.25 },
  vermelho: { x: 0.25, y: 0.75 },
  azul:     { x: 0.75, y: 0.75 },
}

// Fallback outer-ring radius (image-width fraction) when vision gave none.
const DEFAULT_RING_3_RADIUS = 0.18

// Ring proportions relative to the OUTER ring (anel 3 = 1.0). Measured from the
// official "Alvo Fogo Central 4 Cores SAT/ANP" PDF (Portaria 7508/2017-ANP/DGP/PF,
// 66x48 cm). Real radii from the bull center: zona 5 = 5.34cm, zona 4 = 8.06cm,
// zona 3 = 10.77cm (ratios ~ 2:3:4), mosca = 1.07cm.
const RING_RATIOS = {
  bull: 0.10, // 1.07 / 10.77
  r5: 0.50,   // 5.34 / 10.77  (zona 5: centro ate a 1a linha)
  r4: 0.75,   // 8.06 / 10.77
  r3: 1.00,   // 10.77cm = raio externo
}

const ZONE_POINTS = {
  bull: 5,
  r5: 5,
  r4: 4,
  r3: 3,
  fora: 0,
}

// A hole has physical size. We classify on its INNER edge (toward center) so a
// hole touching or breaking a ring line counts as the higher-value ring
// ("linha vale a maior"). Hole radius as a fraction of the outer ring radius.
const HOLE_RADIUS_RATIO = 0.06

// Isotropic distance in image-width units. sy converts the y axis to width units.
function dist(ax, ay, bx, by, sy) {
  const dx = ax - bx
  const dy = (ay - by) * sy
  return Math.sqrt(dx * dx + dy * dy)
}

function resolveRadii(cal) {
  const r3 = (cal && cal.r3 > 0) ? cal.r3 : DEFAULT_RING_3_RADIUS
  return {
    bull: (cal && cal.bull > 0) ? cal.bull : r3 * RING_RATIOS.bull,
    r5:   (cal && cal.r5 > 0)   ? cal.r5   : r3 * RING_RATIOS.r5,
    r4:   (cal && cal.r4 > 0)   ? cal.r4   : r3 * RING_RATIOS.r4,
    r3,
  }
}

function resolveCalibration(options) {
  const src = (options && options.quadrants) || {}
  const out = {}
  for (const q of QUADRANT_NAMES) {
    const c = src[q] || {}
    const center = (c.bull_center && typeof c.bull_center.x === 'number')
      ? c.bull_center
      : DEFAULT_BULL_CENTERS[q]
    const radiiInput = c.radii || {
      r3: c.ring3_radius ?? c.ring_3_radius ?? c.r3,
      r5: c.ring5_radius ?? c.r5,
      r4: c.ring4_radius ?? c.r4,
      bull: c.bull_radius ?? c.bull,
    }
    out[q] = { center, radii: resolveRadii(radiiInput) }
  }
  return out
}

// Nearest measured bull center. Robust at the seams between quadrants.
function quadrantOf(hole, calibration, sy) {
  let best = QUADRANT_NAMES[0]
  let bestD = Infinity
  for (const q of QUADRANT_NAMES) {
    const c = calibration[q].center
    const d = dist(hole.x, hole.y, c.x, c.y, sy)
    if (d < bestD) { bestD = d; best = q }
  }
  return best
}

function classifyZone(d, radii, holeRadius) {
  const edge = Math.max(0, d - holeRadius) // inner edge -> line rule
  if (edge <= radii.bull) return 'bull'
  if (edge <= radii.r5) return 'r5'
  if (edge <= radii.r4) return 'r4'
  if (edge <= radii.r3) return 'r3'
  return 'fora'
}

function classifyPosition(hole, center, sy) {
  const dx = hole.x - center.x
  const dy = (hole.y - center.y) * sy
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 0.02) return 'C'
  const angle = Math.atan2(-dy, dx) * 180 / Math.PI // -dy: image y grows downward
  const normalized = (angle + 360) % 360
  if (normalized < 22.5 || normalized >= 337.5) return 'E'
  if (normalized < 67.5) return 'NE'
  if (normalized < 112.5) return 'N'
  if (normalized < 157.5) return 'NW'
  if (normalized < 202.5) return 'W'
  if (normalized < 247.5) return 'SW'
  if (normalized < 292.5) return 'S'
  return 'SE'
}

function computeSpreadCm(hits, ring3Radius, sy) {
  if (hits.length < 2) return null
  let maxDist = 0
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const d = dist(hits[i].x, hits[i].y, hits[j].x, hits[j].y, sy)
      if (d > maxDist) maxDist = d
    }
  }
  // Outer ring (anel 3) on the real SAT/ANP target = 10.77cm radius.
  const cmPerUnit = 10.77 / Math.max(ring3Radius, 0.01)
  return Math.round(maxDist * cmPerUnit * 10) / 10
}

// Main entry. holes = [{ x, y, confidence? }]. options.quadrants = per-quadrant
// calibration measured by vision. options.imageAspect = width/height (default 1).
// Output shape is unchanged so UI, DB and stats keep working.
export function scoreHoles(holes, options = {}) {
  const calibration = resolveCalibration(options)
  const imageAspect = options.imageAspect > 0 ? options.imageAspect : 1
  const sy = 1 / imageAspect // y(height-frac) -> width units

  const quadrantes = {}
  for (const q of QUADRANT_NAMES) {
    quadrantes[q] = {
      hits: [],
      bull_center: calibration[q].center,
      ring_3_radius: calibration[q].radii.r3,
      ring_radii: calibration[q].radii,
      disparos: 0,
      pontos: 0,
      spread_cm: null,
    }
  }

  let totalDisparos = 0
  let totalPontos = 0

  for (const hole of (holes || [])) {
    if (typeof hole.x !== 'number' || typeof hole.y !== 'number') continue
    const q = quadrantOf(hole, calibration, sy)
    const { center, radii } = calibration[q]
    const d = dist(hole.x, hole.y, center.x, center.y, sy)
    const holeRadius = radii.r3 * HOLE_RADIUS_RATIO
    const zone = classifyZone(d, radii, holeRadius)
    const position = classifyPosition(hole, center, sy)
    const points = ZONE_POINTS[zone]
    quadrantes[q].hits.push({
      x: hole.x,
      y: hole.y,
      zone,
      position,
      points,
      confidence: hole.confidence || 'high',
    })
    totalDisparos++
    totalPontos += points
  }

  for (const q of QUADRANT_NAMES) {
    quadrantes[q].disparos = quadrantes[q].hits.length
    quadrantes[q].pontos = quadrantes[q].hits.reduce((s, h) => s + h.points, 0)
    quadrantes[q].spread_cm = computeSpreadCm(quadrantes[q].hits, quadrantes[q].ring_3_radius, sy)
  }

  return {
    total_disparos: totalDisparos,
    total_pontos: totalPontos,
    avg_pts_per_shot: totalDisparos > 0 ? totalPontos / totalDisparos : 0,
    image_aspect: imageAspect,
    quadrantes,
  }
}

// Rescore after manual add/remove. Preserves per-quadrant calibration and aspect.
export function rescoreScoring(scoring) {
  const allHoles = []
  const quadrants = {}
  for (const q of QUADRANT_NAMES) {
    const qData = scoring?.quadrantes?.[q]
    if (!qData) { quadrants[q] = {}; continue }
    quadrants[q] = {
      bull_center: qData.bull_center || DEFAULT_BULL_CENTERS[q],
      radii: qData.ring_radii || { r3: qData.ring_3_radius },
    }
    for (const h of (qData.hits || [])) {
      allHoles.push({ x: h.x, y: h.y, confidence: h.confidence })
    }
  }
  return scoreHoles(allHoles, { quadrants, imageAspect: scoring?.image_aspect })
}

export {
  QUADRANT_NAMES,
  ZONE_POINTS,
  RING_RATIOS,
  DEFAULT_BULL_CENTERS,
  DEFAULT_RING_3_RADIUS,
}
