import { scoreHoles, countScoring } from './scoring.js'
import { detectTarget } from './detect.js'
import { calibrationFromFrame, getTarget, DEFAULT_TARGET } from './targets.js'

// Aspect ratio (largura/altura) da imagem, pra distancia isotropica no scoring.
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

// Re-pontua a partir de furos + quadro + tipo de alvo. Usado quando o atirador
// ajusta o quadro (a geometria muda, entao nao da pra reaproveitar os centros
// antigos: recalcula a calibracao do quadro novo e pontua de novo).
export function scoreWithFrame(holes, { frame, targetType = DEFAULT_TARGET, imageAspect = 1 } = {}) {
  const t = getTarget(targetType)
  if (t.mode === 'count') return countScoring(holes || [], imageAspect)
  const { quadrants } = calibrationFromFrame(frame, targetType)
  return scoreHoles(holes || [], { quadrants, imageAspect })
}

// Redetecta furos DENTRO de um quadro (ajustado pelo atirador) e re-pontua, sem
// chamar a IA. Usado pelo botao "redetectar no quadro" depois de corrigir a area.
export async function detectAndScore({ photo, frame = null, targetType = DEFAULT_TARGET }) {
  const { holes, frame: usedFrame } = await detectTarget(photo, { frame })
  const imageAspect = await getImageAspect(photo)
  const scoring = scoreWithFrame(holes, { frame: usedFrame, targetType, imageAspect })
  return { scoring, frame: usedFrame, holes }
}

// Pipeline: deteccao por visao computacional (local, deterministica) dentro do
// quadro -> geometria do tipo de alvo a partir do quadro -> scoring
// deterministico -> diagnostico textual (IA, sem visao).
// frame: quadro ajustado (opcional). Se nulo, a deteccao propoe um.
export async function analyzeTarget({ photo, arma, calibre, expectedShots, distancia, targetType = DEFAULT_TARGET, frame = null }) {
  const { holes, frame: usedFrame } = await detectTarget(photo, { frame })
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
    detectionNotes: '',
    rawHoles: holes,
    resumoError,
  }
}
