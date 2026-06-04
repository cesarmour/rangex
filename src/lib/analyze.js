import { scoreHoles } from './scoring.js'
import { detectTarget } from './detect.js'

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

// Pipeline: deteccao por visao computacional (local, deterministica) ->
// scoring deterministico -> diagnostico textual (IA, sem visao).
export async function analyzeTarget({ photo, arma, calibre, expectedShots, distancia }) {
  const { holes, quadrants } = await detectTarget(photo)
  const imageAspect = await getImageAspect(photo)
  const scoring = scoreHoles(holes, { quadrants, imageAspect })

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
    detectionNotes: '',
    rawHoles: holes,
    resumoError,
  }
}
