import { scoreHoles, countScoring } from './scoring.js'
import { detectTarget } from './detect.js'
import { calibrationFromFrame, getTarget, DEFAULT_TARGET } from './targets.js'

// Localizacao dos furos:
//   true  -> VISION (netlify/functions/analyze-target.js): enxerga o branco mesmo
//            colado na mosca, varre os 4 quadrantes. Caminho confiavel neste alvo.
//   false -> CV local deterministico (detect.js). Sem custo de API.
// O SCORING e sempre deterministico (scoring.js sobre o quadro). Vira pra false
// se quiser localizacao 100% deterministica.
export const USE_AI_DETECTION = true

function getImageAspect(dataUrl) {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        const a = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
        resolve(a > 0 && isFinite(a) ? a : 1)
      }
      img.onerror = () => resolve(1)
      img.src = dataUrl
    } catch { resolve(1) }
  })
}

function clamp01(v) { return Math.max(0, Math.min(1, typeof v === 'number' && isFinite(v) ? v : 0)) }

// Reduz a foto antes de mandar pro vision: payload menor e resposta mais rapida
// (evita estourar limite de corpo / timeout da function). Nao afeta a foto
// guardada nem a exibida; e so o que vai pro detector.
function downscaleDataURL(dataUrl, maxDim = 1100, quality = 0.82) {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        const big = Math.max(img.naturalWidth, img.naturalHeight)
        const scale = big > 0 ? Math.min(1, maxDim / big) : 1
        if (scale >= 1) { resolve(dataUrl); return }
        const w = Math.round(img.naturalWidth * scale)
        const h = Math.round(img.naturalHeight * scale)
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(c.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch { resolve(dataUrl) }
  })
}

// Le a resposta como texto e tenta JSON. Se nao for JSON, devolve o motivo REAL
// (status + inicio do corpo) em vez de um generico, pra dar pra diagnosticar.
async function readJson(res, label) {
  const raw = await res.text()
  let data
  try { data = JSON.parse(raw) }
  catch {
    const snippet = (raw || '').replace(/\s+/g, ' ').trim().slice(0, 180)
    throw new Error(`${label}: status ${res.status}, corpo nao-JSON: ${snippet || '(vazio)'}`)
  }
  if (!res.ok) throw new Error(data.error || `${label}: status ${res.status}`)
  return data
}

// Localizacao por VISION. Retorna [{x,y}] em fracao 0..1 da imagem. Lanca em erro.
async function aiDetectHoles({ photo, arma, calibre, expectedShots, distancia }) {
  const small = await downscaleDataURL(photo)
  const res = await fetch('/api/analyze-target', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo: small, arma, calibre, expectedShots, distancia }),
  })
  const data = await readJson(res, 'detector IA')
  if (!Array.isArray(data.holes)) throw new Error('detector IA: resposta sem campo holes')
  return data.holes
    .filter((h) => h && typeof h.x === 'number' && typeof h.y === 'number')
    .map((h) => ({ x: clamp01(h.x), y: clamp01(h.y) }))
}

// Acha os furos (vision com fallback local) + quadro semente. Reporta a fonte e,
// se a IA falhou, o motivo (sem esconder no fallback).
async function locateHoles({ photo, arma, calibre, expectedShots, distancia, frame }) {
  let holes = null
  let source = 'local'
  let aiError = null
  if (USE_AI_DETECTION) {
    if (!arma || !calibre) {
      aiError = 'arma/calibre não informados (IA pulada)'
    } else {
      try {
        holes = await aiDetectHoles({ photo, arma, calibre, expectedShots, distancia })
        source = 'ai'
      } catch (e) {
        aiError = e.message || 'falha no detector IA'
        console.error('AI detection failed, fallback local:', e)
      }
    }
  }
  const local = await detectTarget(photo, { frame })
  if (holes === null) holes = local.holes
  const usedFrame = frame || local.frame
  return { holes, frame: usedFrame, source, aiError }
}

// Diagnostico textual (so texto, sem visao) a partir do scoring ja calculado.
export async function diagnoseShooting({ arma, calibre, distancia, scoring }) {
  const res = await fetch('/api/diagnose-shooting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arma, calibre, distancia, scoring }),
  })
  const data = await readJson(res, 'resumo')
  return { resumo: data.resumo || '' }
}

// Pontua furos a partir do quadro + tipo de alvo (deterministico).
export function scoreWithFrame(holes, { frame, targetType = DEFAULT_TARGET, imageAspect = 1 } = {}) {
  const t = getTarget(targetType)
  if (t.mode === 'count') return countScoring(holes || [], imageAspect)
  const { quadrants } = calibrationFromFrame(frame, targetType)
  return scoreHoles(holes || [], { quadrants, imageAspect })
}

// Redetecta (vision + fallback) e re-pontua contra o quadro atual, sem IA de texto.
export async function detectAndScore({ photo, arma, calibre, expectedShots, distancia, frame = null, targetType = DEFAULT_TARGET }) {
  const { holes, frame: usedFrame, source, aiError } = await locateHoles({ photo, arma, calibre, expectedShots, distancia, frame })
  const imageAspect = await getImageAspect(photo)
  const scoring = scoreWithFrame(holes, { frame: usedFrame, targetType, imageAspect })
  return { scoring, frame: usedFrame, holes, source, aiError }
}

// Pipeline completo: localizacao (vision/local) -> scoring (quadro) -> diagnostico.
export async function analyzeTarget({ photo, arma, calibre, expectedShots, distancia, targetType = DEFAULT_TARGET, frame = null }) {
  const { holes, frame: usedFrame, source, aiError } = await locateHoles({ photo, arma, calibre, expectedShots, distancia, frame })
  const imageAspect = await getImageAspect(photo)
  const scoring = scoreWithFrame(holes, { frame: usedFrame, targetType, imageAspect })

  let narrative = { resumo: '' }
  let resumoError = null
  if (scoring.total_disparos > 0) {
    try {
      narrative = await diagnoseShooting({ arma, calibre, distancia, scoring })
    } catch (e) {
      console.error('Resumo failed:', e)
      resumoError = e.message || 'falha ao gerar o resumo'
    }
  }

  return {
    disparos: scoring.total_disparos,
    pontos: scoring.total_pontos,
    resumo: narrative.resumo,
    diagnostico: narrative.resumo,
    quadrantes: { amarelo: '', verde: '', vermelho: '', azul: '' },
    scoring,
    targetType,
    frame: usedFrame,
    detectionSource: source,
    detectionError: aiError,
    rawHoles: holes,
    resumoError,
  }
}
