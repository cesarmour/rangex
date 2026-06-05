// Deteccao de furos por visao computacional LOCAL, sem IA.
//
// Modelo: cada quadrante e uma cor solida (amarelo/verde/vermelho/azul). Um furo
// PERTURBA essa cor: vira pétala branca de papel rasgado (claro) OU buraco/sombra
// (escuro). Em ambos os casos a SATURACAO cai (deixa de ser a cor vivida). Entao o
// sinal de furo e "dessaturado dentro do quadro", o que pega tanto o furo claro
// quanto o furo escuro denso (que o detector antigo de so-branco perdia).
//
// O que NAO e furo e descartado por construcao:
//   - mosca preta impressa: disco escuro no centro de cada padrao, mascarado por
//     geometria (mas furo CLARO em cima da mosca e mantido).
//   - aneis tracejados e numeros impressos: cinza-medio sem pétala clara nem miolo
//     escuro -> componente que nao tem pixel claro nem escuro e descartado.
//   - sombra da dobra na borda do papel: margem de seguranca pra dentro do quadro.
//
// A deteccao NAO decide a geometria de pontuacao (centros/aneis vem de targets.js
// a partir do quadro). detect*FromPixels sao nucleos puros (testaveis fora do
// browser); detectTarget carrega a imagem num canvas e chama os nucleos.
//
// Orientacao: o navegador ja aplica o EXIF na <img> ao desenhar no canvas, entao
// os pixels chegam na orientacao que o usuario ve. Nao re-rotacionamos aqui.

import { frameToQuad, quadBBox, quadWidth, bilinear, pointInQuad } from './targets.js'

// Erosao/dilatacao 3x3 binarias (Uint8Array de 0/1).
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

// Componentes conectados (4-vizinhanca). Se `lum` e dado, rastreia o brilho
// minimo e maximo do componente (pra separar furo de impressao cinza-media).
function components(mask, w, h, lum = null) {
  const lbl = new Int32Array(w * h)
  const blobs = []
  const stack = []
  let cur = 0
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lbl[s]) continue
    cur++
    let area = 0, sx = 0, sy = 0
    let minx = w, maxx = 0, miny = h, maxy = 0
    let minl = 255, maxl = 0
    stack.length = 0
    stack.push(s); lbl[s] = cur
    while (stack.length) {
      const i = stack.pop()
      const x = i % w, y = (i / w) | 0
      area++; sx += x; sy += y
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      if (lum) { const L = lum[i]; if (L < minl) minl = L; if (L > maxl) maxl = L }
      if (x > 0 && mask[i - 1] && !lbl[i - 1]) { lbl[i - 1] = cur; stack.push(i - 1) }
      if (x < w - 1 && mask[i + 1] && !lbl[i + 1]) { lbl[i + 1] = cur; stack.push(i + 1) }
      if (y > 0 && mask[i - w] && !lbl[i - w]) { lbl[i - w] = cur; stack.push(i - w) }
      if (y < h - 1 && mask[i + w] && !lbl[i + w]) { lbl[i + w] = cur; stack.push(i + w) }
    }
    blobs.push({ area, cx: sx / area, cy: sy / area, minx, maxx, miny, maxy, minl, maxl })
  }
  return blobs
}

// 1) Quadro = bbox do maior componente saturado (quadrantes coloridos vs parede).
// Retorna fracoes 0..1 da imagem, ou null se nada saturado encontrado.
export function detectFrameFromPixels(data, w, h) {
  const N = w * h
  const colored = new Uint8Array(N)
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2]
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b)
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b)
    colored[i] = (mx - mn) > 55 ? 1 : 0
  }
  const closed = close3(colored, w, h, 3)
  const blobs = components(closed, w, h)
  if (!blobs.length) return null
  let big = blobs[0]
  for (const b of blobs) if (b.area > big.area) big = b
  return {
    x0: big.minx / w,
    y0: big.miny / h,
    x1: big.maxx / w,
    y1: big.maxy / h,
  }
}

// Encolhe o quadrilatero em direcao ao centroide por fracao f (margem de borda).
function shrinkQuad(quad, f) {
  const cx = (quad.tl.x + quad.tr.x + quad.bl.x + quad.br.x) / 4
  const cy = (quad.tl.y + quad.tr.y + quad.bl.y + quad.br.y) / 4
  const s = (p) => ({ x: cx + (p.x - cx) * (1 - f), y: cy + (p.y - cy) * (1 - f) })
  return { tl: s(quad.tl), tr: s(quad.tr), bl: s(quad.bl), br: s(quad.br) }
}

// 2) Furos DENTRO do quadro, por desvio de cor (saturacao). frame = quadrilatero
// {tl,tr,bl,br} ou retangulo legado {x0,y0,x1,y1}. opts.centers = lista de centros
// de mosca {x,y} (fracoes 0..1) pra mascarar a mosca impressa. Retorna [{x,y}].
export function detectHolesFromPixels(data, w, h, frame, opts = {}) {
  const N = w * h
  const quad = frameToQuad(frame)
  const bb = quadBBox(quad)
  const fx0 = bb.x0 * w, fx1 = bb.x1 * w, fy0 = bb.y0 * h, fy1 = bb.y1 * h
  if (fx1 - fx0 < 2 || fy1 - fy0 < 2) return []
  const fwpx = quadWidth(quad) * w

  // Margem pra dentro do quadro: mata sombra da dobra na borda do papel.
  const MARGIN = 0.09
  const sq = shrinkQuad(quad, MARGIN)
  const ix0 = Math.max(1, Math.floor(fx0))
  const ix1 = Math.min(w - 1, Math.ceil(fx1))
  const iy0 = Math.max(1, Math.floor(fy0))
  const iy1 = Math.min(h - 1, Math.ceil(fy1))

  // Brilho por pixel (media RGB) e mascara de impacto (dessaturado dentro do quadro).
  const lum = new Uint8Array(N)
  const impact = new Uint8Array(N)
  const SAT_T = 65
  for (let y = iy0; y < iy1; y++) {
    const yf = y / h
    for (let x = ix0; x < ix1; x++) {
      const i = y * w + x
      const p = i * 4
      const r = data[p], g = data[p + 1], b = data[p + 2]
      lum[i] = (r + g + b) / 3
      if (!pointInQuad(sq, x / w, yf)) continue
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b)
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b)
      if ((mx - mn) < SAT_T) impact[i] = 1
    }
  }

  // Mosca impressa: disco escuro no centro de cada padrao. Mascara so a parte
  // ESCURA da mosca; furo CLARO em cima dela (lum alto) e mantido.
  const centers = opts.centers || []
  if (centers.length) {
    const rad = 0.10 * fwpx
    for (const c of centers) {
      const ccx = c.x * w, ccy = c.y * h
      let sxx = 0, syy = 0, cnt = 0
      const x0 = Math.max(0, Math.floor(ccx - rad)), x1 = Math.min(w - 1, Math.ceil(ccx + rad))
      const y0 = Math.max(0, Math.floor(ccy - rad)), y1 = Math.min(h - 1, Math.ceil(ccy + rad))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - ccx, dy = y - ccy
          if (dx * dx + dy * dy > rad * rad) continue
          const i = y * w + x, p = i * 4
          const r = data[p], g = data[p + 1], b = data[p + 2]
          const mn = r < g ? (r < b ? r : b) : (g < b ? g : b)
          const mx = r > g ? (r > b ? r : b) : (g > b ? g : b)
          if ((r + g + b) / 3 < 75 && (mx - mn) < 55) { sxx += x; syy += y; cnt++ }
        }
      }
      if (cnt > 40) {
        const mcx = sxx / cnt, mcy = syy / cnt
        const mr = Math.sqrt(cnt / Math.PI) * 1.2
        const mr2 = mr * mr
        const bx0 = Math.max(0, Math.floor(mcx - mr)), bx1 = Math.min(w - 1, Math.ceil(mcx + mr))
        const by0 = Math.max(0, Math.floor(mcy - mr)), by1 = Math.min(h - 1, Math.ceil(mcy + mr))
        for (let y = by0; y <= by1; y++) {
          for (let x = bx0; x <= bx1; x++) {
            const dx = x - mcx, dy = y - mcy
            if (dx * dx + dy * dy > mr2) continue
            const i = y * w + x
            if (lum[i] < 150) impact[i] = 0 // mantem furo claro sobre a mosca
          }
        }
      }
    }
  }

  const blobs = components(open3(impact, w, h), w, h, lum)
  const Amin = 0.00003 * N
  const Amax = 0.01 * N
  const holes = []
  for (const b of blobs) {
    if (b.area < Amin || b.area > Amax) continue
    // descarta impressao cinza-media (numero/anel): sem pétala clara nem miolo escuro
    if (!(b.maxl > 200 || b.minl < 48)) continue
    // descarta blob que encosta na borda da varredura (moldura/parede que vaza)
    if (b.minx <= ix0 + 1 || b.maxx >= ix1 - 1 || b.miny <= iy0 + 1 || b.maxy >= iy1 - 1) continue
    holes.push({ x: b.cx / w, y: b.cy / h })
  }
  return holes
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Falha ao carregar a imagem'))
    img.src = src
  })
}

// Centros de mosca (fracoes 0..1) de um tipo de alvo dentro do quadro.
export function moscaCenters(frame, target) {
  if (!target || !Array.isArray(target.patterns)) return []
  const quad = frameToQuad(frame)
  return target.patterns.map((p) => bilinear(quad, p.u, p.v))
}

// Wrapper de browser. frame = quadro ajustado (ou semente detectada). target =
// objeto de targets.js (pra saber onde estao as moscas). Retorna { holes, frame }.
export async function detectTarget(dataUrl, { frame = null, target = null } = {}) {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, 700 / img.naturalWidth)
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const usedFrame = frame || detectFrameFromPixels(data, w, h) ||
    { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 }
  const centers = target ? moscaCenters(usedFrame, target) : []
  const holes = detectHolesFromPixels(data, w, h, usedFrame, { centers })
  return { holes, frame: usedFrame }
}
