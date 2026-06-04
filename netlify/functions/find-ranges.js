// Netlify Function: /.netlify/functions/find-ranges
// Receives { lat, lng } and returns the 3 closest shooting ranges
// using Google Places API (Nearby Search).

const GOOGLE_PLACES_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'

// Haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)}m`
  return `${(m / 1000).toFixed(1)}km`
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'GOOGLE_MAPS_API_KEY não configurada no Netlify.',
        code: 'NO_KEY',
      }),
    }
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const { lat, lng } = body
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'lat e lng são obrigatórios e numéricos' }),
    }
  }

  try {
    // Search with multiple keywords to catch different naming conventions in PT-BR
    const keywords = ['clube de tiro', 'stand de tiro', 'shooting range']
    const allResults = new Map() // dedupe by place_id

    for (const keyword of keywords) {
      const url = new URL(GOOGLE_PLACES_URL)
      url.searchParams.set('location', `${lat},${lng}`)
      url.searchParams.set('radius', '50000') // 50km
      url.searchParams.set('keyword', keyword)
      url.searchParams.set('language', 'pt-BR')
      url.searchParams.set('key', apiKey)

      const resp = await fetch(url.toString())
      const data = await resp.json()

      if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: data.error_message || `Google Places error: ${data.status}`,
            code: data.status,
          }),
        }
      }

      if (data.results) {
        for (const place of data.results) {
          if (!allResults.has(place.place_id)) {
            allResults.set(place.place_id, place)
          }
        }
      }
    }

    // Compute distance and sort
    const ranges = Array.from(allResults.values())
      .map((p) => ({
        place_id: p.place_id,
        name: p.name,
        address: p.vicinity || p.formatted_address || '',
        rating: p.rating || null,
        userRatingsTotal: p.user_ratings_total || 0,
        distance: distanceMeters(lat, lng, p.geometry.location.lat, p.geometry.location.lng),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5) // top 5 by distance
      .map((r) => ({ ...r, distanceLabel: formatDistance(r.distance) }))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ranges }),
    }
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    }
  }
}
