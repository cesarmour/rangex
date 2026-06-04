import { useState, useEffect } from 'react'
import { loadRanking } from '../lib/db.js'

const METRICS = [
  { key: 'avgPtsPerShot', label: 'PTS/TIRO', precision: 2 },
  { key: 'totalDisparos', label: 'Disparos', precision: 0 },
  { key: 'totalPontos', label: 'Pontos', precision: 0 },
  { key: 'totalTrainings', label: 'Sessões', precision: 0 },
]

export default function RankingScreen({ currentUserId, optedIn, onToggleOptIn, currentClub }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [metricIdx, setMetricIdx] = useState(0)
  const [scope, setScope] = useState('all') // 'all' | 'club'

  // If user has no club selected, force scope to 'all'
  const effectiveScope = currentClub?.name ? scope : 'all'
  const clubFilter = effectiveScope === 'club' ? currentClub.name : null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadRanking(clubFilter)
      .then((r) => { if (!cancelled) { setData(r); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [optedIn, clubFilter])

  const metric = METRICS[metricIdx]
  const sorted = data
    ? [...data].sort((a, b) => Number(b[metric.key] || 0) - Number(a[metric.key] || 0))
    : []

  return (
    <div className="bg-dark text-white pb-32 min-h-screen-content">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {/* Header */}
        <div className="evo-card relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-tactical" />
          <div className="p-6">
            <div className="text-[10px] tracking-[0.2em] text-orange-tactical uppercase border border-orange-tactical/30 inline-block px-2 py-1 mb-3 font-mono">
              Leaderboard
            </div>
            <h1 className="text-3xl font-display uppercase tracking-wide leading-none mb-2">
              Ranking <span className="text-red-tactical">Geral</span>
            </h1>
            <div className="text-[11px] tracking-[0.1em] text-stone-400 uppercase">
              {effectiveScope === 'club' && currentClub?.name
                ? <>Apenas <span className="text-orange-tactical">{currentClub.name}</span></>
                : 'Atiradores participantes · todos clubes'}
            </div>
          </div>
        </div>

        {/* Opt-in banner */}
        {!optedIn && (
          <div className="evo-card border border-orange-tactical/40">
            <div className="p-4">
              <div className="text-sm font-semibold mb-1">Você ainda não tá no ranking</div>
              <div className="text-[11px] text-stone-400 leading-relaxed mb-3">
                Só usuários que ativaram a participação aparecem aqui. Suas estatísticas continuam privadas pra você.
              </div>
              <button
                onClick={onToggleOptIn}
                className="px-4 py-2 bg-orange-tactical text-black text-xs font-bold tracking-wide rounded-md hover:opacity-90 transition active:scale-[0.98] font-mono"
              >
                ENTRAR NO RANKING
              </button>
            </div>
          </div>
        )}

        {/* Scope filter */}
        {currentClub?.name && (
          <div>
            <div className="text-[9px] tracking-[0.18em] uppercase text-stone-500 mb-1.5 font-mono">Escopo</div>
            <div className="flex gap-2">
              <ScopeButton
                active={effectiveScope === 'all'}
                onClick={() => setScope('all')}
                label="Todos clubes"
              />
              <ScopeButton
                active={effectiveScope === 'club'}
                onClick={() => setScope('club')}
                label={currentClub.name}
                truncate
              />
            </div>
          </div>
        )}

        {/* Metric tabs */}
        <div>
          <div className="text-[9px] tracking-[0.18em] uppercase text-stone-500 mb-1.5 font-mono">Métrica</div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {METRICS.map((m, i) => (
              <button
                key={m.key}
                onClick={() => setMetricIdx(i)}
                className={`px-3 py-2 rounded-md text-xs font-mono whitespace-nowrap transition border ${
                  metricIdx === i
                    ? 'bg-red-tactical text-white border-red-tactical'
                    : 'bg-black/40 text-stone-300 border-white/10 hover:border-white/30'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="evo-card p-8 text-center">
            <Spinner />
            <div className="text-xs text-stone-400 mt-3 font-mono">Carregando ranking…</div>
          </div>
        )}

        {error && (
          <div className="evo-card border border-red-tactical/40 p-4">
            <div className="text-sm font-semibold text-red-tactical">Erro</div>
            <div className="text-xs text-stone-400 mt-1">{error}</div>
            <div className="text-[10px] text-stone-500 mt-2">
              Se for a primeira vez, talvez você ainda precise rodar a migration SQL do ranking no Supabase.
            </div>
          </div>
        )}

        {/* Ranking list */}
        {!loading && !error && sorted.length === 0 && (
          <div className="evo-card p-8 text-center">
            <div className="text-sm font-light">
              {effectiveScope === 'club'
                ? `Nenhum atirador registrado em ${currentClub.name}`
                : 'Nenhum atirador no ranking ainda'}
            </div>
            <div className="text-[11px] text-stone-400 mt-1">
              {effectiveScope === 'club'
                ? 'Seja o primeiro a treinar aqui.'
                : 'Seja o primeiro a participar.'}
            </div>
          </div>
        )}

        {!loading && !error && sorted.length > 0 && (
          <div className="evo-card divide-y divide-white/5">
            {sorted.map((row, i) => {
              const isMe = row.id === currentUserId
              const position = i + 1
              const topThree = position <= 3
              const posColor = position === 1
                ? 'bg-orange-tactical text-black'
                : position === 2
                  ? 'bg-stone-300 text-black'
                  : position === 3
                    ? 'bg-amber-700 text-white'
                    : 'bg-white/5 text-stone-400'
              const value = Number(row[metric.key] || 0)
              const valueStr = metric.precision > 0
                ? value.toFixed(metric.precision)
                : value.toLocaleString('pt-BR')

              return (
                <div
                  key={row.id}
                  className={`flex items-center gap-3 p-4 ${
                    isMe ? 'bg-orange-tactical/10 border-l-2 border-orange-tactical' : ''
                  }`}
                >
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${posColor}`}>
                    <span className={`font-display font-bold ${topThree ? 'text-lg' : 'text-sm'}`}>
                      {String(position).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                      <span className="truncate">{row.displayName}</span>
                      {isMe && <span className="text-orange-tactical text-[10px] font-mono flex-shrink-0">VOCÊ</span>}
                      {row.challengeWins > 0 && (
                        <span className="flex-shrink-0 inline-flex items-center gap-1 bg-orange-tactical/20 border border-orange-tactical/40 text-orange-tactical text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded font-mono" title={`${row.challengeWins} ${row.challengeWins === 1 ? 'vitória em duelo' : 'vitórias em duelos'}`}>
                          {row.challengeWins}W
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-stone-400 font-mono">
                      {row.totalTrainings} sessões · {row.totalDisparos.toLocaleString('pt-BR')} disparos
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-display font-semibold">{valueStr}</div>
                    <div className="text-[9px] text-stone-500 tracking-wider uppercase font-mono">{metric.label}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ScopeButton({ active, onClick, label, truncate }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 rounded-md text-xs font-mono transition border min-w-0 ${
        active
          ? 'bg-orange-tactical text-black border-orange-tactical font-bold'
          : 'bg-black/40 text-stone-300 border-white/10 hover:border-white/30'
      }`}
    >
      <span className={truncate ? 'block truncate' : ''}>{label}</span>
    </button>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-6 w-6 mx-auto text-orange-tactical" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
