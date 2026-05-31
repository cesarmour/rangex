import { useState } from 'react'
import PhotoInput from './PhotoInput.jsx'
import { analyzeTarget } from '../lib/analyze.js'

export default function SessionCard({ session, index, acervo, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)

  const update = (patch) => onChange({ ...session, ...patch })

  const updateArma = (armaId) => {
    const item = acervo.find((a) => a.id === armaId)
    if (item) {
      update({ armaId, arma: item.arma, calibre: item.calibre })
    }
  }

  const runAnalysis = async () => {
    if (!session.photo) {
      setAnalyzeError('Adicione uma foto do alvo primeiro.')
      return
    }
    if (!session.arma) {
      setAnalyzeError('Selecione a arma usada primeiro.')
      return
    }

    setAnalyzeError(null)
    setAnalyzing(true)
    try {
      const result = await analyzeTarget({
        photo: session.photo,
        arma: session.arma,
        calibre: session.calibre,
        expectedShots: session.disparos > 0 ? session.disparos : null,
        distancia: session.distancia > 0 ? session.distancia : null,
      })
      update({
        disparos: result.disparos,
        pontos: result.pontos,
        quadrantes: result.quadrantes,
        diagnostico: result.diagnostico,
        analyzed: true,
      })
      setShowDetails(true)
    } catch (e) {
      setAnalyzeError(e.message || 'Erro ao analisar')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-navy text-white text-xs font-bold flex items-center justify-center">
            S{index + 1}
          </div>
          <div>
            <div className="text-sm font-semibold flex items-center gap-1.5">
              <span>{session.arma || 'Sem arma'}</span>
              {session.analyzed && (
                <span className="text-[9px] tracking-[0.1em] uppercase text-gold font-semibold bg-gold/10 px-1.5 py-0.5 rounded">
                  analisada
                </span>
              )}
            </div>
            <div className="text-[11px] text-stone-500">
              {session.calibre || '—'}  ·  {session.disparos || 0} disparos  ·  {session.pontos || 0} pts{session.distancia ? `  ·  ${session.distancia}m` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded(!expanded)} className="btn-ghost">
            {expanded ? '-' : '+'}
          </button>
          <button onClick={onRemove} className="btn-ghost text-red-600">
            ×
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          <div>
            <div className="label mb-1.5">Arma</div>
            <select
              className="input"
              value={session.armaId || ''}
              onChange={(e) => updateArma(e.target.value)}
            >
              <option value="">Selecione…</option>
              {acervo.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.arma}  ·  {a.calibre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="label mb-1.5">Foto do alvo</div>
            <PhotoInput
              value={session.photo}
              onChange={(photo) => update({ photo, analyzed: false })}
            />
          </div>

          {session.photo && session.arma && (
            <div className="space-y-2">
              {!session.analyzed && !session.disparos && (
                <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed">
                  <strong>Dica:</strong> se você sabe quantos tiros deu, preenche o campo <strong>Disparos</strong> abaixo antes de analisar. A IA usa esse número como referência e fica mais precisa. Sem isso, ela conta sozinha e pode errar pra mais ou pra menos.
                </div>
              )}
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="w-full px-4 py-3 bg-navy text-white text-sm font-semibold tracking-wide rounded-md hover:bg-navy-700 disabled:opacity-50 transition flex items-center justify-center gap-2 border-b-2 border-gold"
              >
                {analyzing ? (
                  <>
                    <Spinner />
                    <span>Analisando alvo…</span>
                  </>
                ) : (
                  <span>{session.analyzed ? 'Reanalisar com IA' : 'Analisar com IA'}</span>
                )}
              </button>
              {analyzeError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">
                  {analyzeError}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="label mb-1.5">Disparos</div>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                value={session.disparos || ''}
                onChange={(e) => update({ disparos: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
            </div>
            <div>
              <div className="label mb-1.5">Pontos</div>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                value={session.pontos || ''}
                onChange={(e) => update({ pontos: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
            </div>
            <div>
              <div className="label mb-1.5">Distância</div>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  className="input pr-7"
                  value={session.distancia || ''}
                  onChange={(e) => update({ distancia: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400 pointer-events-none">m</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-stone-500 hover:text-navy underline"
          >
            {showDetails ? '- ocultar' : '+ análise por quadrante e diagnóstico'}
          </button>

          {showDetails && (
            <div className="space-y-3 pt-2 border-t border-stone-100">
              <div className="grid grid-cols-2 gap-3">
                {['amarelo', 'verde', 'vermelho', 'azul'].map((q) => (
                  <div key={q}>
                    <div className="label mb-1.5 capitalize">{q}</div>
                    <textarea
                      className="input min-h-[60px] resize-none"
                      rows={2}
                      value={session.quadrantes?.[q] || ''}
                      onChange={(e) =>
                        update({
                          quadrantes: { ...session.quadrantes, [q]: e.target.value },
                        })
                      }
                      placeholder="agrupamento e padrão…"
                    />
                  </div>
                ))}
              </div>

              <div>
                <div className="label mb-1.5">Diagnóstico técnico</div>
                <textarea
                  className="input min-h-[80px] resize-none"
                  rows={3}
                  value={session.diagnostico || ''}
                  onChange={(e) => update({ diagnostico: e.target.value })}
                  placeholder="leitura técnica da sessão…"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-gold" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
