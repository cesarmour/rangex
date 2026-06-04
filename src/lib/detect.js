// Deteccao de furos e moscas por visao computacional, sem IA.
// O tiro neste alvo NG e uma mancha BRANCA de papel rasgado sobre a cor do
// quadrante. Isso e detectavel direto dos pixels, com precisao, de forma
// deterministica. A IA sai do caminho da localizacao.
//
// Saida: { holes:[{x,y}], quadrants:{ q:{bull_center:{x,y}, ring3_radius,...} } }
// tudo em fracao 0..1 da imagem inteira, no mesmo formato que scoreHoles espera.
//
// detectFromPixels(data,w,h) e o nucleo puro (testavel fora do browser).
// detectTarget(dataUrl) carrega a imagem num canvas e chama o nucleo.

const QNAMES = ['amarelo', 'verde', 'vermelho', 'azul']

// Erosao 3x3 (binaria). src/dst sao Uint8Array de 0/1.
function erode(src, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!src[i]) continue
      if (src[i - 1] && src[i + 1] && src[i - w] && src[i + w] &&
          src[i - w - 1] && src[i - w + 1] && src[i + w - 1] && src[i + w + 1]) {
        out[i] = 1
      }
    }
  }
  return out
}

function dilate(src, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!src[i]) continue
      out[i] = 1
      out[i - 1] = 1; out[i + 1] = 1; out[i - w] = 1; out[i + w] = 1
      out[i - w - 1] = 1; out[i - w + 1] = 1; out[i + w - 1] = 1; out[i + w + 1] = 1
    }
  }
  return out
}

const open3 = (m, w, h) => dilate(erode(m, w, h), w, h)
function close3(m, w, h, times = 1) {
  let r = m
  for (let i = 0; i < times; i++) r = dilate(r, w, h)
  for (let i = 0; i < times; i++) r = erode(r, w, h)
  return r
}

// Componentes conectados (4-vizinhanca) via BFS. Retorna lista de blobs com
// area, soma de coordenadas (pra centroide) e bbox.
function components(mask, w, h) {
  const lbl = new Int32Array(w * h)
  const blobs = []
  const stack = []
  let cur = 0
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lbl[s]) continue
    cur++
    let area = 0, sx = 0, sy = 0
    let minx = w, maxx = 0, miny = h, maxy = 0
    stack.length = 0
    stack.push(s); lbl[s] = cur
    while (stack.length) {
      const i = stack.pop()
      const x = i % w, y = (i / w) | 0
      area++; sx += x; sy += y
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      if (x > 0 && mask[i - 1] && !lbl[i - 1]) { lbl[i - 1] = cur; stack.push(i - 1) }
      if (x < w - 1 && mask[i + 1] && !lbl[i + 1]) { lbl[i + 1] = cur; stack.push(i + 1) }
      if (y > 0 && mask[i - w] && !lbl[i - w]) { lbl[i - w] = cur; stack.push(i - w) }
      if (y < h - 1 && mask[i + w] && !lbl[i + w]) { lbl[i + w] = cur; stack.push(i + w) }
    }
    blobs.push({ area, cx: sx / area, cy: sy / area, minx, maxx, miny, maxy })
  }
  return blobs
}

export function detectFromPixels(data, w, h) {
  const N = w * h
  const sat = new Uint8Array(N), lum = new Uint8Array(N), mnArr = new Uint8Array(N)
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2]
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b)
    const m = r < g ? (r < b ? r : b) : (g < b ? g : b)
    sat[i] = mx - m; mnArr[i] = m; lum[i] = ((r + g + b) / 3) | 0
  }

  // 1) Area do alvo = maior componente saturado (quadrantes coloridos vs parede)
  const colored = new Uint8Array(N)
  for (let i = 0; i < N; i++) colored[i] = sat[i] > 55 ? 1 : 0
  const closed = close3(colored, w, h, 3)
  const cblobs = components(closed, w, h)
  if (!cblobs.length) return { holes: [], quadrants: emptyQuadrants() }
  let big = cblobs[0]
  for (const b of cblobs) if (b.area > big.area) big = b
  const bx0 = big.minx, bx1 = big.maxx, by0 = big.miny, by1 = big.maxy
  const bw = bx1 - bx0, bh = by1 - by0
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2

  const quadOf = (px, py) => {
    const left = px < cx, top = py < cy
    return left ? (top ? 'amarelo' : 'vermelho') : (top ? 'verde' : 'azul')
  }
  const qcenter = {
    amarelo:  { x: (bx0 + cx) / 2, y: (by0 + cy) / 2 },
    verde:    { x: (cx + bx1) / 2, y: (by0 + cy) / 2 },
    vermelho: { x: (bx0 + cx) / 2, y: (cy + by1) / 2 },
    azul:     { x: (cx + bx1) / 2, y: (cy + by1) / 2 },
  }

  // 2) Moscas = blob escuro proximo do centro do quadrante (fallback: centro)
  const dark = new Uint8Array(N)
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    const i = y * w + x
    if (lum[i] < 85) dark[i] = 1
  }
  const dblobs = components(open3(dark, w, h), w, h)
  const dAmin = 0.00002 * N, dAmax = 0.002 * N, dMaxDist = 0.22 * bw
  const bulls = {}
  for (const b of dblobs) {
    if (b.area < dAmin || b.area > dAmax) continue
    const q = quadOf(b.cx, b.cy), qc = qcenter[q]
    const dd = (b.cx - qc.x) ** 2 + (b.cy - qc.y) ** 2
    if (Math.sqrt(dd) > dMaxDist) continue
    if (!bulls[q] || dd < bulls[q].dd) bulls[q] = { x: b.cx, y: b.cy, dd }
  }
  for (const q of QNAMES) if (!bulls[q]) bulls[q] = { x: qcenter[q].x, y: qcenter[q].y, dd: 0 }

  // 3) Furos = mancha branca pequena no miolo (margem afasta reflexo de borda)
  const m = 0.12
  const ix0 = bx0 + m * bw, ix1 = bx1 - m * bw, iy0 = by0 + m * bh, iy1 = by1 - m * bh
  const white = new Uint8Array(N)
  for (let y = Math.floor(iy0); y < iy1; y++) for (let x = Math.floor(ix0); x < ix1; x++) {
    const i = y * w + x
    if (mnArr[i] > 165 && sat[i] < 50) white[i] = 1
  }
  const wblobs = components(open3(white, w, h), w, h)
  const wAmin = 0.000015 * N, wAmax = 0.0004 * N
  const holes = []
  for (const b of wblobs) {
    if (b.area < wAmin || b.area > wAmax) continue
    holes.push({ x: b.cx / w, y: b.cy / h })
  }

  // ring3 (anel externo) = 10.77cm num alvo de 48cm de largura -> 0.2244 da largura.
  // Medido do PDF oficial SAT/ANP. scoring.js preenche r5/r4/bull pelas proporcoes.
  const ring3 = 0.2244 * (bw / w)
  const quadrants = {}
  for (const q of QNAMES) {
    quadrants[q] = {
      bull_center: { x: bulls[q].x / w, y: bulls[q].y / h },
      ring3_radius: ring3,
      ring4_radius: 0,
      ring5_radius: 0,
    }
  }
  return { holes, quadrants }
}

function emptyQuadrants() {
  const q = {}
  for (const n of QNAMES) q[n] = { bull_center: { x: 0.5, y: 0.5 }, ring3_radius: 0.2, ring4_radius: 0, ring5_radius: 0 }
  return q
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Falha ao carregar a imagem'))
    img.src = src
  })
}

// Wrapper de browser: carrega a foto, reduz pra ~700px de largura (rapido e
// suficiente) e roda o nucleo.
export async function detectTarget(dataUrl) {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, 700 / img.naturalWidth)
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  return detectFromPixels(data, w, h)
}
