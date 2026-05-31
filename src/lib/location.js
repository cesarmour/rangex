// Geolocation + find nearby ranges

export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalização não suportada nesse navegador.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const messages = {
          1: 'Permissão de localização negada. Permita nas configurações ou escolha um clube manualmente.',
          2: 'Não foi possível obter sua localização.',
          3: 'Tempo esgotado ao obter localização.',
        }
        reject(new Error(messages[err.code] || err.message || 'Erro na geolocalização.'))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000, ...options }
    )
  })
}

export async function findNearbyRanges({ lat, lng }) {
  const res = await fetch('/api/find-ranges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  })
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error('Resposta inválida do servidor')
  }
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`)
    err.code = data.code
    throw err
  }
  return data.ranges || []
}
