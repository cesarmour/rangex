// Netlify Function: /.netlify/functions/analyze-target
// Receives a target photo + weapon info, calls Anthropic API with vision,
// returns structured analysis matching the report format.

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'

const SYSTEM_PROMPT = `Você é um instrutor de tiro experiente, especializado em análise técnica de alvos de papel. Está analisando uma foto de alvo NG Alvos de 4 quadrantes coloridos:

- AMARELO (superior esquerdo)
- VERDE (superior direito)
- VERMELHO (inferior esquerdo)
- AZUL (inferior direito)

Cada quadrante tem anéis concêntricos numerados 5-4-3 (do centro pra fora) com uma mosca preta no centro. Pontuação: mosca = 5, anel 5 = 5, anel 4 = 4, anel 3 = 3, fora dos anéis = 0.

CONTAGEM DE IMPACTOS - PRECISÃO ACIMA DE TUDO:
Conte furos reais. Não invente, não infle, não chute pra cima nem pra baixo.

O que é um furo de bala:
- Buraco escuro com bordas dilaceradas em formato de estrela ou pétalas brancas/claras saindo (papel rasgado pra fora)
- Tamanho consistente com o calibre (9mm/.38/.380 fazem furo de ~9-12mm)
- Geralmente circular ou oval

O que NÃO é furo:
- Sombras, vincos, dobras do papel
- Marcas de impressão do alvo (números, anéis tracejados, logos)
- Sujeira, rasuras superficiais
- Bordas do alvo, marcas dos clipes/grampos de fixação
- Reflexos da iluminação

Sobre rosetões (furos sobrepostos):
- Um cluster de pétalas brancas com 2-3 furos centrais nítidos = conte exatamente quantos centros escuros consegue identificar
- NÃO assuma que todo cluster grande tem mais furos do que se vê
- Se 3 furos formam uma flor de papel com 3 centros distinguíveis, são 3 furos. Ponto.

Quando em dúvida sobre um ponto: marque sua incerteza no quadrante mas não conte. É melhor reportar menos com precisão do que mais com chute.

Padrões diagnósticos clássicos (atirador destro):
- Baixo-esquerda: antecipação de coice + dedo demais no gatilho (puxa cano pra esquerda)
- Alto-direita: pulled trigger, empurrão, ou anticipação invertida
- Alto consistente em todos os quadrantes: zero ou POA (não é técnica)
- Baixo consistente: heeling ou ferrolho frouxo
- Dispersão vertical: respiração ou trigger inconsistente
- Dispersão lateral aleatória: grip inconsistente
- Stringing: variação de munição, parallax, ou múltiplos POAs

Tom da resposta: direto, técnico, sem suavização, sem travessões (use vírgulas ou dois pontos). Estilo de instrutor experiente. Use vocabulário técnico (cluster, agrupamento, dispersão, viés, POA, antecipação, flinch, stringing). Português do Brasil.`

const USER_PROMPT_TEMPLATE = ({ arma, calibre, expectedShots, distancia }) => {
  const groundTruth = expectedShots && expectedShots > 0
    ? `\n\nGROUND TRUTH: o atirador disparou EXATAMENTE ${expectedShots} tiros no total (ele sabe, contou o carregador). Você DEVE retornar "disparos": ${expectedShots}. Distribua os impactos pelos 4 quadrantes de forma consistente com a foto. Se você só identifica visualmente menos de ${expectedShots}, sinalize na descrição do quadrante onde estão os impactos sobrepostos prováveis. Se identifica mais, revise sua contagem - alguns "furos" provavelmente são marcas ou sombras.`
    : `\n\nConte os disparos com PRECISÃO. Conte só furos reais e nítidos. Em caso de dúvida sobre um ponto específico, não conte. Reportar 9 com certeza é melhor que reportar 12 chutando.`

  const dist = distancia && distancia > 0
    ? `\nDistância do alvo: ${distancia}m.`
    : ''

  return `Atirador disparou uma ${arma} em ${calibre}.${dist}${groundTruth}

Analise a foto do alvo e retorne APENAS um objeto JSON válido (sem markdown, sem preâmbulo, sem texto extra):

{
  "disparos": <número total de tiros somando os 4 quadrantes${expectedShots && expectedShots > 0 ? `; DEVE ser ${expectedShots}` : '; conte com precisão, sem inflar'}>,
  "pontos": <pontuação total estimada baseada na zona de cada impacto>,
  "quadrantes": {
    "amarelo": "<1-2 frases: quantos impactos contou, agrupamento, dispersão aproximada em cm, localização em relação ao bull>",
    "verde": "<1-2 frases>",
    "vermelho": "<1-2 frases>",
    "azul": "<1-2 frases>"
  },
  "diagnostico": "<2-4 frases de diagnóstico técnico. Identifique o padrão dominante e atribua a causa provável (antecipação, trigger control, zero, POA, fadiga, etc.). Mencione plataforma, calibre e distância quando relevante.>"
}`
}

export const handler = async (event) => {
  // CORS for local dev
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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'ANTHROPIC_API_KEY não configurada. Defina a variável de ambiente no painel do Netlify (Site settings → Environment variables).',
      }),
    }
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const { photo, arma, calibre, expectedShots, distancia } = body
  if (!photo || !arma || !calibre) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Faltam campos obrigatórios: photo, arma, calibre' }),
    }
  }

  // Extract base64 from data URL
  const match = photo.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'photo precisa ser data URL (data:image/...;base64,...)' }),
    }
  }
  const mediaType = match[1]
  const base64 = match[2]

  // Call Anthropic API
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              { type: 'text', text: USER_PROMPT_TEMPLATE({ arma, calibre, expectedShots, distancia }) },
            ],
          },
        ],
      }),
    })

    const data = await resp.json()

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers,
        body: JSON.stringify({
          error: data.error?.message || 'Anthropic API error',
          details: data,
        }),
      }
    }

    // Extract text from response
    const textBlocks = (data.content || []).filter((b) => b.type === 'text')
    const text = textBlocks.map((b) => b.text).join('\n').trim()

    // Parse JSON (strip markdown fences if present)
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Resposta do modelo não é JSON válido',
          raw: text,
        }),
      }
    }

    // Validate structure
    if (
      typeof parsed.disparos !== 'number' ||
      typeof parsed.pontos !== 'number' ||
      typeof parsed.quadrantes !== 'object' ||
      typeof parsed.diagnostico !== 'string'
    ) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Estrutura da resposta inválida',
          parsed,
        }),
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        disparos: expectedShots && expectedShots > 0
          ? expectedShots
          : Math.round(parsed.disparos),
        pontos: Math.round(parsed.pontos),
        quadrantes: {
          amarelo: parsed.quadrantes.amarelo || '',
          verde: parsed.quadrantes.verde || '',
          vermelho: parsed.quadrantes.vermelho || '',
          azul: parsed.quadrantes.azul || '',
        },
        diagnostico: parsed.diagnostico,
        usage: data.usage,
      }),
    }
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message }),
    }
  }
}
