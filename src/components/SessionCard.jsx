import { useState } from 'react'
import PhotoInput from './PhotoInput.jsx'
import TargetOverlay from './TargetOverlay.jsx'
import { analyzeTarget, diagnoseShooting, scoreWithFrame, detectAndScore } from '../lib/analyze.js'
import { targetList, DEFAULT_TARGET, DEFAULT_FRAME } from '../lib/targets.js'

const QKEYS = ['amarelo', 'verde', 'vermelho', 'azul']

// Junta todos os furos do scoring num array plano (pra re-pontuar com outro
// quadro/tipo sem reaproveitar os centros antigos).
function gatherHoles(scoring) {
  const holes = []
  for (const q of QKEYS) {
    const qd = scoring?.quadrantes?.[q]
    if (!qd?.hits) continue
    for (const h of qd.hits) holes.push({ x: h.x, y: h.y, confidence: h.confidence })
  }
  return holes
}

export default function SessionCard({ session, index, acervo, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [redetecting, setRedetecting] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [redoingDiagnosis, setRedoingDiagnosis] = useState(false)

  const update = (patch) => onChange({ ...session, ...patch })
  const targetType = session.targetType || DEFAULT_TARGET

  const updateArma = (armaId) => {
    const item = acervo.find((a) => a.id === armaId)
    if (item) update({ armaId, arma: item.arma, calibre: item.calibre })
  }

  const changeTargetType = (newType) => {
    if (session.analyzed && session.scoring) {
      const holes = gatherHoles(session.scoring)
      const newScoring = scoreWithFrame(holes, {
        frame: session.frame || DEFAULT_FRAME,
        targetType: newType,
        imageAspect: session.scoring.image_aspect,
      })
      update({
        targetType: newType,
        scoring: newScoring,
        disparos: newScoring.total_disparos,
        pontos: newScoring.total_pontos,
        diagnosisStale: true,
      })
    } else {
      update({ targetType: newType })
    }
  }

  const runAnalysis = async () => {
    if (!session.photo) { setAnalyzeError('Adicione uma foto do alvo primeiro.'); return }
    if (!session.arma) { setAnalyzeError('Selecione a arma usada primeiro.'); return }

    setAnalyzeError(null)
    setAnalyzing(true)
    try {
      const result = await analyzeTarget({
        photo: session.photo,
        arma: session.arma,
        calibre: session.calibre,
        expectedShots: session.disparos > 0 ? session.disparos : null,
        distancia: session.distancia > 0 ? session.distancia : null,
        targetType,
        frame: session.frame || null,
      })
      update({
        disparos: result.disparos,
        pontos: result.pontos,
        resumo: result.resumo,
        diagnostico: result.resumo,
        analyzed: true,
        scoring: result.scoring,
        frame: result.frame,
        targetType: result.targetType,
      })
      setShowDetails(true)
      const msgs = []
      if (result.detectionSource !== 'ai' && result.detectionError) {
        msgs.push(`Detector IA falhou, caí no local (só pega agrupamento nítido, perde o topo). Motivo: ${result.detectionError}`)
      }
      if (result.resumoError) {
        msgs.push(`Resumo automático falhou: ${result.resumoError}`)
      }
      setAnalyzeError(msgs.length ? msgs.join('  ·  ') : null)
    } catch (e) {
      setAnalyzeError(e.message || 'Erro ao analisar')
    } finally {
      setAnalyzing(false)
    }
  }

  // Redetecta furos dentro do quadro corrigido, sem IA. Pega os furos do topo
  // que a detecção automática tinha perdido quando o quadro estava errado.
  const redetectInFrame = async () => {
    if (!session.photo) return
    setAnalyzeError(null)
    setRedetecting(true)
    try {
      const { scoring, frame, source, aiError } = await detectAndScore({
        photo: session.photo,
        arma: session.arma,
        calibre: session.calibre,
        expectedShots: session.disparos > 0 ? session.disparos : null,
        distancia: session.distancia > 0 ? session.distancia : null,
        frame: session.frame || null,
        targetType,
      })
      update({
        scoring,
        frame,
        disparos: scoring.total_disparos,
        pontos: scoring.total_pontos,
        diagnosisStale: true,
      })
      if (source !== 'ai' && aiError) {
        setAnalyzeError(`Detector IA falhou, caí no local (perde o topo). Motivo: ${aiError}`)
      }
    } catch (e) {
      setAnalyzeError(e.message || 'Erro ao redetectar')
    } finally {
      setRedetecting(false)
    }
  }

  // Edicao manual de furos (overlay ja re-pontua reaproveitando os centros).
  const handleScoringChange = (newScoring) => {
    update({
      scoring: newScoring,
      disparos: newScoring.total_disparos,
      pontos: newScoring.total_pontos,
      diagnosisStale: true,
    })
  }

  // Atirador ajustou o quadro: recalcula a geometria do quadro novo e re-pontua
  // os furos atuais (nao da pra reaproveitar os centros antigos).
  const handleFrameChange = (newFrame) => {
    const holes = gatherHoles(session.scoring)
    const newScoring = scoreWithFrame(holes, {
      frame: newFrame,
      targetType,
      imageAspect: session.scoring?.image_aspect,
    })
    update({
      frame: newFrame,
      scoring: newScoring,
      disparos: newScoring.total_disparos,
      pontos: newScoring.total_pontos,
      diagnosisStale: true,
    })
  }

  const regenerateDiagnosis = async () => {
    if (!session.scoring) return
    setRedoingDiagnosis(true)
    try {
      const result = await diagnoseShooting({
        arma: session.arma,
        calibre: session.calibre,
        distancia: session.distancia > 0 ? session.distancia : null,
        scoring: session.scoring,
      })
      update({ resumo: result.resumo, diagnostico: result.resumo, diagnosisStale: false })
    } catch (e) {
      setAnalyzeError(e.message || 'Erro ao regenerar diagnóstico')
    } finally {
      setRedoingDiagnosis(false)
    }
  }

  const types = targetList()

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
          <button onClick={() => setExpanded(!expanded)} className="btn-ghost">{expanded ? '-' : '+'}</button>
          <button onClick={onRemove} className="btn-ghost text-red-600">×</button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          <div>
            <div className="label mb-1.5">Arma</div>
            <select className="input" value={session.armaId || ''} onChange={(e) => updateArma(e.target.value)}>
              <option value="">Selecione…</option>
              {acervo.map((a) => (
                <option key={a.id} value={a.id}>{a.arma}  ·  {a.calibre}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="label mb-1.5">Tipo de alvo</div>
            <select className="input" value={targetType} onChange={(e) => changeTargetType(e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            {types.find((t) => t.id === targetType)?.mode === 'count' && (
              <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed mt-1.5">
                Este alvo detecta e conta os furos, mas ainda <strong>não pontua por zonas</strong>. Pontuação graduada (zonas/valores) precisa das medidas oficiais do alvo — me manda a face e a tabela de pontos pra eu calibrar.
              </div>
            )}
          </div>

          <div>
            <div className="label mb-1.5">Foto do alvo</div>
            {session.photo && session.analyzed && session.scoring ? (
              <div className="space-y-2">
                {session.scoring.total_disparos === 0 && (
                  <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5 leading-relaxed">
                    <strong>Nenhum furo detectado.</strong> Entre em "corrigir marcações", ajuste o quadro amarelo sobre o alvo e toque em "redetectar no quadro", ou marque os furos na mão tocando na foto.
                  </div>
                )}
                <TargetOverlay
                  photo={session.photo}
                  scoring={session.scoring}
                  editable={editMode || session.scoring.total_disparos === 0}
                  onScoringChange={handleScoringChange}
                  frame={session.frame}
                  targetType={targetType}
                  frameEditable={editMode || session.scoring.total_disparos === 0}
                  onFrameChange={handleFrameChange}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setEditMode(!editMode)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                      editMode ? 'bg-gold text-navy' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    {editMode || session.scoring.total_disparos === 0 ? 'concluir edição' : 'corrigir marcações'}
                  </button>
                  {(editMode || session.scoring.total_disparos === 0) && (
                    <button
                      onClick={redetectInFrame}
                      disabled={redetecting}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-100 text-stone-700 hover:bg-stone-200 disabled:opacity-50 transition"
                    >
                      {redetecting ? 'redetectando…' : 'redetectar no quadro'}
                    </button>
                  )}
                  <button
                    onClick={() => update({ photo: null, analyzed: false, scoring: null, frame: null, detection: null, diagnosisStale: false })}
                    className="text-xs text-stone-500 hover:text-red-600 underline"
                  >
                    trocar foto
                  </button>
                </div>
              </div>
            ) : (
              <PhotoInput
                value={session.photo}
                onChange={(photo) => update({ photo, analyzed: false, scoring: null, frame: null, detection: null })}
              />
            )}
          </div>

          {session.photo && session.arma && !session.analyzed && (
            <div className="space-y-2">
              {!session.disparos && (
                <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed">
                  <strong>Dica:</strong> se você sabe quantos tiros deu, preenche o campo <strong>Disparos</strong> abaixo antes de analisar.
                </div>
              )}
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="w-full px-4 py-3 bg-navy text-white text-sm font-semibold tracking-wide rounded-md hover:bg-navy-700 disabled:opacity-50 transition flex items-center justify-center gap-2 border-b-2 border-gold"
              >
                {analyzing ? (<><Spinner /><span>Detectando furos…</span></>) : (<span>Analisar com IA</span>)}
              </button>
              {analyzeError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{analyzeError}</div>
              )}
            </div>
          )}

          {session.photo && session.arma && session.analyzed && (
            <div className="space-y-2">
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="w-full px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold tracking-wide rounded-md transition flex items-center justify-center gap-2"
              >
                {analyzing ? <><Spinner /><span>Reanalisando…</span></> : <span>Reanalisar com IA</span>}
              </button>
              {analyzeError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{analyzeError}</div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="label mb-1.5">Disparos</div>
              <input type="number" inputMode="numeric" className="input"
                value={session.disparos || ''} onChange={(e) => update({ disparos: parseInt(e.target.value) || 0 })} placeholder="0" />
            </div>
            <div>
              <div className="label mb-1.5">Pontos</div>
              <input type="number" inputMode="numeric" className="input"
                value={session.pontos || ''} onChange={(e) => update({ pontos: parseInt(e.target.value) || 0 })} placeholder="0" />
            </div>
            <div>
              <div className="label mb-1.5">Distância</div>
              <div className="relative">
                <input type="number" inputMode="decimal" className="input pr-7"
                  value={session.distancia || ''} onChange={(e) => update({ distancia: parseFloat(e.target.value) || 0 })} placeholder="0" />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400 pointer-events-none">m</span>
              </div>
            </div>
          </div>

          <button onClick={() => setShowDetails(!showDetails)} className="text-xs text-stone-500 hover:text-navy underline">
            {showDetails ? '- ocultar' : '+ resumo da sessão'}
          </button>

          {showDetails && (
            <div className="space-y-3 pt-2 border-t border-stone-100">
              {session.diagnosisStale && (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md p-2.5">
                  <div className="text-[11px] text-amber-800">Você alterou as marcações. O diagnóstico abaixo é do estado anterior.</div>
                  <button onClick={regenerateDiagnosis} disabled={redoingDiagnosis}
                    className="text-[11px] font-semibold text-navy underline disabled:opacity-50">
                    {redoingDiagnosis ? 'atualizando…' : 'atualizar diagnóstico'}
                  </button>
                </div>
              )}
              <div>
                <div className="label mb-1.5">Resumo da sessão</div>
                <textarea className="input min-h-[120px] resize-none leading-relaxed" rows={5}
                  value={session.resumo || session.diagnostico || ''}
                  onChange={(e) => update({ resumo: e.target.value, diagnostico: e.target.value })}
                  placeholder="agrupamento, viés, causa provável e recomendação…" />
                {session.analyzed && !session.resumo && !session.diagnostico && (
                  <div className="text-[11px] text-stone-500 mt-1">O resumo não foi gerado. Toque em "Reanalisar com IA" ou escreva o seu.</div>
                )}
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
