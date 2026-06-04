// Deteccao de furos por visao computacional LOCAL, sem IA.
// O tiro neste alvo arranca o papel colorido e expoe o branco por baixo: o furo
// e uma MANCHA BRANCA de papel rasgado sobre a cor, nao um buraco escuro.
//
// Mudanca de arquitetura: a deteccao NAO decide mais a geometria (centros e
// aneis). Ela faz duas coisas e so:
//   1) detectFrameFromPixels: propoe um QUADRO (frame) = area do alvo, como
//      semente pro atirador ajustar. {x0,y0,x1,y1} em fracao 0..1 da imagem.
//   2) detectHolesFromPixels: varre furos DENTRO de um quadro dado.
// Os centros de mosca e os raios dos aneis vem de targets.js a partir do quadro.
// Isso elimina o modo de falha em que o topo do alvo lavava no reflexo, o bbox
// encolhia pra baixo e os quadrantes de cima ficavam fora da analise.
//
// detect*FromPixels sao nucleos puros (testaveis fora do browser).
// detectTarget(dataUrl, {frame}) carrega a imagem num canvas e chama os nucleos.

import { frameToQuad, quadBBox, pointInQuad } from './targets.js'

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

// Componentes conectados (4-vizinhanca) via flood fill iterativo.
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

// 2) Furos = manchas brancas pequenas DENTRO do quadro. frame = quadrilatero
// {tl,tr,bl,br} ou retangulo legado {x0,y0,x1,y1}. Retorna [{x,y}] fracoes 0..1.
export function detectHolesFromPixels(data, w, h, frame) {
  const N = w * h
  const quad = frameToQuad(frame)
  const bb = quadBBox(quad)
  const fx0 = bb.x0 * w, fx1 = bb.x1 * w, fy0 = bb.y0 * h, fy1 = bb.y1 * h
  const fw = fx1 - fx0, fh = fy1 - fy0
  if (fw < 2 || fh < 2) return []

  // Margem pequena pra afastar reflexo na borda do quadro, sem comer o miolo.
  const m = 0.04
  const ix0 = Math.max(1, Math.floor(fx0 + m * fw))
  const ix1 = Math.min(w - 1, Math.ceil(fx1 - m * fw))
  const iy0 = Math.max(1, Math.floor(fy0 + m * fh))
  const iy1 = Math.min(h - 1, Math.ceil(fy1 - m * fh))

  const white = new Uint8Array(N)
  for (let y = iy0; y < iy1; y++) {
    const yf = y / h
    for (let x = ix0; x < ix1; x++) {
      // so dentro do quadrilatero (alvo empenado: bbox sobra fora do alvo)
      if (!pointInQuad(quad, x / w, yf)) continue
      const i = y * w + x
      const p = i * 4
      const r = data[p], g = data[p + 1], b = data[p + 2]
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b)
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b)
      // branco = canal minimo alto (claro) e baixa saturacao (nao colorido)
      if (mn > 165 && (mx - mn) < 50) white[i] = 1
    }
  }

  const wblobs = components(open3(white, w, h), w, h)
  // Tamanho do furo depende da RESOLUCAO da imagem (canvas ~700px), nao do
  // tamanho do quadro. Por isso o filtro de area e relativo a IMAGEM (N), com os
  // coeficientes que ja funcionavam. (Erro anterior: relativo ao quadro, que
  // subia o minimo e rejeitava as manchas brancas pequenas dos furos limpos.)
  const wAmin = 0.000015 * N
  const wAmax = 0.0004 * N
  const holes = []
  for (const b of wblobs) {
    if (b.area < wAmin || b.area > wAmax) continue
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

// Wrapper de browser. Se frame e dado (quadro ajustado pelo atirador), varre os
// furos dentro dele. Senao, detecta um quadro semente e varre dentro dele.
// Retorna { holes, frame } em fracoes 0..1 da imagem.
export async function detectTarget(dataUrl, { frame = null } = {}) {
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
  const holes = detectHolesFromPixels(data, w, h, usedFrame)
  return { holes, frame: usedFrame }
}
