// Calls the Netlify function (or local dev fallback) to analyze a target photo
export async function analyzeTarget({ photo, arma, calibre, expectedShots, distancia }) {
  const endpoint = '/api/analyze-target'

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo, arma, calibre, expectedShots, distancia }),
  })

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('Resposta inválida do servidor')
  }

  if (!res.ok) {
    throw new Error(data.error || `Erro ${res.status}`)
  }

  return data
}
