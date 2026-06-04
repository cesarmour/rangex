import { scoreHoles, countScoring } from './scoring.js'
import { detectTarget } from './detect.js'
import { calibrationFromFrame, getTarget, DEFAULT_TARGET } from './targets.js'

// Localizacao dos furos:
//   true  -> usa o VISION (netlify/functions/analyze-target.js). Ele enxerga o
//            papel rasgado branco mesmo colado na mosca, varre os 4 quadrantes e
//            separa rosetao. E o caminho confiavel neste alvo (o CV por limiar
//            local nao acha os furos limpos/escuros do topo).
//   false -> usa o CV local deterministico (detect.js). Sem custo de API.
// O SCORING continua deterministico nos dois casos (scoring.js sobre o quadro).
// Vira a chave pra false se quiser localizacao 100% deterministica.
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

// Localizacao por VISION. Retorna [{x,y}] em fracao 0..1 da imagem. Lanca em erro
// (pra quem chama cair no fallback local).
async function aiDetectHoles({ photo, arma, calibre, expectedShots, distancia }) {
  const res = await fetch('/api/analyze-target', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo, arma, calibre, expectedShots, distancia }),
  })
  let data
  try { data = await res.json() } catch { throw new Error('Resposta inválida do detector') }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status} no detector`)
  if (!Array.isArray(data.holes)) throw new Error('Detector não retornou furos')
  return data.holes
    .filter((h) => h && typeof h.x === 'number' && typeof h.y === 'number')
    .map((h) => ({ x: clamp01(h.x), y: clamp01(h.y) }))
}

// Acha os furos (vision com fallback local) e um quadro semente pra geometria.
async function locateHoles({ photo, arma, calibre, expectedShots, distancia, frame }) {
  let holes = null
  let source = 'local'
  if (USE_AI_DETECTION && arma && calibre) {
    try {
      holes = await aiDetectHoles({ photo, arma, calibre, expectedShots, distancia })
      source = 'ai'
    } catch (e) {
      console.error('AI detection failed, fallback local:', e)
    }
  }
  // Quadro: usa o ajustado pelo atirador; senao o semente do CV local. (O vision
  // ve a imagem toda, entao o quadro aqui serve so pra geometria/escala do score.)
  const local = await detectTarget(photo, { frame })
  if (holes === null) holes = local.holes
  const usedFrame = frame || local.frame
  return { holes, frame: usedFrame, source }
}

// Diagnostico textual (so texto, sem visao) a partir do scoring ja calculado.
export async function diagnoseShooting({ arma, calibre, distancia, scoring }) {
  const res = await fetch('/api/diagnose-shooting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arma, calibre, distancia, scoring }),
  })
  let data
  try { data = await res.json() } catch { throw new Error('Resposta inválida do servidor') }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
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
  const { holes, frame: usedFrame, source } = await locateHoles({ photo, arma, calibre, expectedShots, distancia, frame })
  const imageAspect = await getImageAspect(photo)
  const scoring = scoreWithFrame(holes, { frame: usedFrame, targetType, imageAspect })
  return { scoring, frame: usedFrame, holes, source }
}

// Pipeline completo: localizacao (vision/local) -> scoring (quadro) -> diagnostico.
export async function analyzeTarget({ photo, arma, calibre, expectedShots, distancia, targetType = DEFAULT_TARGET, frame = null }) {
  const { holes, frame: usedFrame, source } = await locateHoles({ photo, arma, calibre, expectedShots, distancia, frame })
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
    rawHoles: holes,
    resumoError,
  }
}
