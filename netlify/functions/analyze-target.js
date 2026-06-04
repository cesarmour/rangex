// Detect bullet holes AND the target geometry the app needs to score.
// Vision measures the big, high-contrast features it is reliable at:
//   - per quadrant: the mosca (bull) center and the printed ring radii
//   - a flat list of bullet-hole coordinates
// It does NOT assign points or rings. That math happens deterministically in
// src/lib/scoring.js against this calibration.
//
// Coordinates: x = fraction 0..1 of image WIDTH, y = fraction 0..1 of image HEIGHT.
// Ring radii: fraction of image WIDTH.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'

const SYSTEM_PROMPT = `Você analisa fotos de alvos NG: papel com 4 quadrantes coloridos (amarelo em cima-esquerda, verde em cima-direita, vermelho embaixo-esquerda, azul embaixo-direita). Cada quadrante tem uma MOSCA PRETA impressa no centro e anéis concêntricos tracejados (do centro pra fora: mosca, anel 5, anel 4, anel 3), com os números 3/4/5 impressos.

Você faz DUAS coisas, ambas puramente geométricas. Você NÃO conta pontos e NÃO diz em qual anel cada furo caiu; isso é feito depois pelo app.

== O QUE É UM FURO ==
Neste alvo o projétil arranca o papel colorido e expõe o branco por baixo. Por isso um furo de bala aparece como uma MANCHA BRANCA de papel rasgado (pétalas claras) sobre a cor do quadrante. O sinal do furo é o BRANCO. O furo geralmente NÃO tem centro escuro: na maioria das vezes é só a mancha branca clara contra o amarelo/verde/vermelho/azul. Tamanho de calibre de arma curta.

== O QUE NÃO É FURO ==
- A MOSCA PRETA impressa no centro de cada quadrante: é um círculo preto liso e sólido, sem pétalas brancas. É referência de calibração, NUNCA um furo.
- Os números 3/4/5, as linhas tracejadas dos anéis, sombras, vincos, dobras, reflexos, grampos, e a parede ou o chão ao fundo.
Regra simples: sem branco de papel rasgado, não é furo. Preto sozinho não é furo.

== FURO COLADO NA MOSCA ==
Tiros bons caem perto do centro, então o branco costuma aparecer TOCANDO, na BORDA, ou SOBREPOSTO à mosca preta. Procure o branco mesmo grudado ou em cima da mosca. Mosca preta com manchas brancas na borda indica furo(s) ali. Mosca preta limpa, sem nenhum branco, não tem furo.

== COMO VARRER ==
Examine os 4 quadrantes UM A UM (amarelo, verde, vermelho, azul). Em cada quadrante encontre TODAS as manchas brancas, inclusive as coladas na mosca. Em rosetão (brancos sobrepostos), conte cada núcleo branco distinto como um furo separado. Furos isolados longe do centro contam igual. Um quadrante pode ter zero furos: se não há branco, não invente furo nele.

== CALIBRAÇÃO ==
Para cada quadrante meça (features grandes e nítidas, fáceis de localizar):
- bull_center: o centro da MOSCA PRETA impressa (não é furo).
- os raios dos anéis impressos, como fração da LARGURA da imagem.

Posicione cada furo na coordenada exata do centro da mancha branca correspondente.

PT-BR. Tom técnico.`

const USER_PROMPT_TEMPLATE = ({ arma, calibre, expectedShots, distancia }) => {
  const hint = expectedShots && expectedShots > 0
    ? ` O atirador disparou ${expectedShots} tiros. Use como referência: se contar menos manchas brancas que isso, varra cada quadrante de novo, principalmente procurando branco colado ou em cima da mosca preta.`
    : ''
  const dist = distancia && distancia > 0 ? ` Distância: ${distancia}m.` : ''

  return `Foto de alvo NG. Arma: ${arma} em ${calibre}.${dist}${hint}

Retorne APENAS JSON neste formato exato:

{
  "quadrants": {
    "amarelo":  { "bull_center": { "x": 0.0, "y": 0.0 }, "ring3_radius": 0.0, "ring4_radius": 0.0, "ring5_radius": 0.0 },
    "verde":    { "bull_center": { "x": 0.0, "y": 0.0 }, "ring3_radius": 0.0, "ring4_radius": 0.0, "ring5_radius": 0.0 },
    "vermelho": { "bull_center": { "x": 0.0, "y": 0.0 }, "ring3_radius": 0.0, "ring4_radius": 0.0, "ring5_radius": 0.0 },
    "azul":     { "bull_center": { "x": 0.0, "y": 0.0 }, "ring3_radius": 0.0, "ring4_radius": 0.0, "ring5_radius": 0.0 }
  },
  "holes": [
    { "x": 0.25, "y": 0.30 },
    { "x": 0.52, "y": 0.28 }
  ],
  "notes": "opcional: incertezas, rosetões, quadrante cortado da foto, etc"
}

Regras das coordenadas:
- x e y são fração 0 a 1 da imagem INTEIRA. x=0 borda esquerda, x=1 borda direita, y=0 topo, y=1 rodapé.
- bull_center é o centro da mosca preta impressa de cada quadrante (NÃO é um furo).
- ring3_radius é o raio do anel mais EXTERNO (anel 3), como fração da LARGURA da imagem. ring4_radius e ring5_radius são os anéis internos. Se você só consegue medir o anel externo com confiança, devolva ring3_radius e deixe os outros como 0 (o app preenche pela proporção do alvo).
- Cada item de "holes" é UMA mancha branca de papel rasgado (um furo), posicionado no centro da mancha. Não agrupe rosetão: 3 brancos sobrepostos = 3 itens com posições próximas.
- Não devolva como furo a mosca preta impressa, nem nada sem branco de papel rasgado.
- Se um quadrante não aparece na foto, devolva bull_center plausível e raios 0; não invente furos nele. Se o quadrante aparece mas não tem nenhuma mancha branca, deixe-o sem furos.
- Se não há furos, devolva "holes": [].

Retorne SOMENTE o JSON, sem markdown, sem preâmbulo.`
}

const SINGLE_QUADRANT_SYSTEM = `Esta imagem é UM quadrante recortado de um alvo NG: um retângulo de cor única (amarelo, verde, vermelho ou azul) com UMA mosca preta impressa próxima ao centro e anéis concêntricos tracejados (do centro pra fora: mosca, anel 5, anel 4, anel 3).

Tarefa puramente geométrica. Você NÃO conta pontos.

== O QUE É UM FURO ==
O projétil arranca o papel e expõe o branco. Um furo aparece como MANCHA BRANCA de papel rasgado sobre a cor, normalmente SEM centro escuro. O sinal é o BRANCO.

== O QUE NÃO É FURO ==
A mosca PRETA impressa (círculo preto liso, sem branco) é referência, nunca furo. Também não são furo: números, linhas tracejadas, sombras, vincos, reflexos, grampos, fundo.

== FURO COLADO NA MOSCA ==
Tiros bons caem perto do centro: o branco costuma tocar, encostar na borda ou ficar sobre a mosca preta. Procure o branco mesmo grudado ou sobre a mosca. Mosca preta limpa, sem branco, não tem furo.

Encontre TODAS as manchas brancas, inclusive coladas na mosca. Rosetão = um furo por núcleo branco distinto. Se não há branco, holes vazio.

Meça também a calibração: bull_center (centro da mosca preta) e os raios dos anéis impressos, como fração da LARGURA desta imagem.

Coordenadas: fração 0 a 1 DESTA imagem (o recorte). PT-BR, tom técnico.`

const SINGLE_QUADRANT_USER = ({ quadrant, arma, calibre, distancia }) => {
  const dist = distancia && distancia > 0 ? ` Distância: ${distancia}m.` : ''
  return `Recorte do quadrante ${quadrant} de um alvo NG. Arma: ${arma} em ${calibre}.${dist}

Retorne APENAS JSON neste formato exato:

{
  "bull_center": { "x": 0.0, "y": 0.0 },
  "ring3_radius": 0.0,
  "ring4_radius": 0.0,
  "ring5_radius": 0.0,
  "holes": [ { "x": 0.0, "y": 0.0 } ]
}

Regras:
- x e y são fração 0 a 1 DESTA imagem (o recorte). x=0 esquerda, x=1 direita, y=0 topo, y=1 base.
- bull_center é o centro da mosca PRETA impressa (não é furo).
- ring3_radius é o raio do anel mais EXTERNO (anel 3), fração da LARGURA da imagem. Se só medir o externo com confiança, devolva ring3_radius e 0 nos outros.
- Cada item de "holes" é UMA mancha branca (um furo), no centro da mancha. Não agrupe rosetão. Não devolva a mosca preta como furo.
- Sem manchas brancas: "holes": [].

Retorne SOMENTE o JSON, sem markdown, sem preâmbulo.`
}

const QUADRANT_NAMES = ['amarelo', 'verde', 'vermelho', 'azul']

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}
function clamp01(v) {
  return Math.max(0, Math.min(1, num(v)))
}

function sanitizeQuadrants(raw) {
  const out = {}
  for (const q of QUADRANT_NAMES) {
    const c = (raw && raw[q]) || {}
    const bc = c.bull_center || {}
    out[q] = {
      bull_center: { x: clamp01(bc.x), y: clamp01(bc.y) },
      ring3_radius: Math.max(0, num(c.ring3_radius)),
      ring4_radius: Math.max(0, num(c.ring4_radius)),
      ring5_radius: Math.max(0, num(c.ring5_radius)),
    }
  }
  return out
}

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  if (!ANTHROPIC_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada' }) }

  let body
  try { body = JSON.parse(event.body) }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) } }

  const { photo, arma, calibre, expectedShots, distancia, quadrant } = body
  if (!photo || !arma || !calibre) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltam campos obrigatórios' }) }
  }

  const match = photo.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Foto inválida' }) }

  const singleMode = typeof quadrant === 'string' && QUADRANT_NAMES.includes(quadrant)
  const system = singleMode ? SINGLE_QUADRANT_SYSTEM : SYSTEM_PROMPT
  const userText = singleMode
    ? SINGLE_QUADRANT_USER({ quadrant, arma, calibre, distancia })
    : USER_PROMPT_TEMPLATE({ arma, calibre, expectedShots, distancia })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2000,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } },
            { type: 'text', text: userText },
          ],
        }],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data.error?.message || 'Erro Anthropic' }) }
    }

    const text = data.content?.[0]?.text || ''
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()

    let parsed
    try { parsed = JSON.parse(cleaned) }
    catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]) }
        catch { return { statusCode: 502, headers, body: JSON.stringify({ error: 'IA retornou JSON inválido', raw: text }) } }
      } else {
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'IA retornou texto sem JSON', raw: text }) }
      }
    }

    if (!Array.isArray(parsed.holes)) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Resposta da IA sem campo holes válido', raw: text }) }
    }

    const holes = parsed.holes
      .filter((h) => h && typeof h.x === 'number' && typeof h.y === 'number')
      .map((h) => ({ x: clamp01(h.x), y: clamp01(h.y) }))

    if (singleMode) {
      const bc = parsed.bull_center || {}
      const hasBull = typeof bc.x === 'number' && typeof bc.y === 'number'
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          holes,
          bull_center: hasBull ? { x: clamp01(bc.x), y: clamp01(bc.y) } : null,
          ring3_radius: Math.max(0, num(parsed.ring3_radius)),
          ring4_radius: Math.max(0, num(parsed.ring4_radius)),
          ring5_radius: Math.max(0, num(parsed.ring5_radius)),
          rawText: text,
          usage: data.usage,
        }),
      }
    }

    const quadrants = sanitizeQuadrants(parsed.quadrants)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        holes,
        quadrants,
        notes: parsed.notes || '',
        rawText: text,
        usage: data.usage,
      }),
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
