// Generate technical shooting diagnosis from structured hit data.
// No vision involved. IA receives only numbers and ring classifications.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'

const SYSTEM_PROMPT = `Você é um instrutor de tiro experiente. Recebe dados estruturados de uma sessão e gera um resumo técnico único, em texto corrido.

Os dados já incluem:
- Quantos furos por quadrante
- Em qual zona caiu cada furo (mosca, anel 5, anel 4, anel 3, fora)
- Posição relativa de cada furo (alto-esquerda, baixo-direita, etc.)
- Dispersão aproximada do agrupamento

NÃO QUESTIONE as contagens nem reanalise furos. Os dados são determinísticos. Sua tarefa é interpretar.

Padrões diagnósticos (atirador destro):
- Baixo-esquerda: antecipação de coice + dedo demais no gatilho
- Alto-direita: pulled trigger, empurrão, antecipação invertida
- Alto consistente em todos: zero/POA, não é técnica
- Baixo consistente: heeling ou ferrolho frouxo
- Dispersão vertical: respiração ou trigger inconsistente
- Dispersão lateral aleatória: grip inconsistente
- Stringing: variação de munição, parallax, ou múltiplos POAs

Tom: direto, técnico, sem suavização, sem travessões (use vírgulas ou dois pontos). Vocabulário de instrutor. PT-BR.`

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

  const { arma, calibre, distancia, scoring } = body
  if (!arma || !calibre || !scoring) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltam campos: arma, calibre, scoring' }) }
  }

  try {
    const userPrompt = buildUserPrompt({ arma, calibre, distancia, scoring })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data.error?.message || 'Erro Anthropic' }) }
    }

    // Plain text on purpose: no JSON parsing to fail. The summary is returned as-is.
    const text = (data.content?.[0]?.text || '')
      .replace(/```[a-z]*\s*/gi, '')
      .replace(/```/g, '')
      .trim()

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        resumo: text,
        usage: data.usage,
      }),
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}

function buildUserPrompt({ arma, calibre, distancia, scoring }) {
  const dist = distancia && distancia > 0 ? `\nDistância: ${distancia}m` : ''
  const quad = scoring.quadrantes || {}
  const avg = typeof scoring.avg_pts_per_shot === 'number' ? scoring.avg_pts_per_shot : 0

  const quadrantLines = ['amarelo', 'verde', 'vermelho', 'azul'].map((q) => {
    const data = quad[q]
    if (!data || !data.disparos) return `- ${q.toUpperCase()}: 0 impactos`
    const hits = (data.hits || []).map((h) => `${h.zone}@${h.position}`).join(', ')
    return `- ${q.toUpperCase()}: ${data.disparos} impactos (${data.pontos} pts) | ${hits}${data.spread_cm ? ` | dispersão ~${data.spread_cm}cm` : ''}`
  }).join('\n')

  return `Sessão de tiro:
Arma: ${arma}
Calibre: ${calibre}${dist}
Total: ${scoring.total_disparos} disparos, ${scoring.total_pontos} pontos (média ${avg.toFixed(2)} pts/tiro)

Distribuição por quadrante:
${quadrantLines}

Posições: bull=mosca, r5/r4/r3=anel correspondente, fora=fora dos anéis. Localização relativa ao centro do bull (NW, N, NE, W, C, E, SW, S, SE).

Escreva um RESUMO técnico único da sessão inteira, de 3 a 5 frases, em texto corrido (sem títulos, sem listas, sem JSON). Cubra: agrupamento e dispersão dominantes, viés direcional predominante, causa técnica provável e uma recomendação curta. Trate os quatro quadrantes em conjunto, mencionando um quadrante só se ele destoar. Sem suavização. Retorne SOMENTE o texto do resumo, sem preâmbulo.`
}
