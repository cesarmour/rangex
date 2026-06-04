import { useState, useEffect, useRef } from 'react'
import { CALIBRES } from '../lib/defaults.js'
import { analyzeTarget } from '../lib/analyze.js'
import {
  findDuelOpponents,
  createDuel,
  acceptDuel,
  declineDuel,
  cancelDuel,
  submitDuelResult,
  listMyDuels,
  uploadChallengePhoto,
  getChallengePhotoUrl,
} from '../lib/db.js'

const EXPECTED_SHOTS = 12
const POLL_INTERVAL_MS = 5000

// Compress image client-side before upload
async function compressImage(dataUrl, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (e) => resolve(e.target.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function formatRemaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function ChallengeScreen({ userId, acervo, club, userDisplayName, optedInRanking, onToggleOptIn }) {
  const [duels, setDuels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('list') // 'list' | 'create' | 'duel'
  const [activeDuelId, setActiveDuelId] = useState(null)
  const pollTimerRef = useRef(null)

  // Poll duels every 5s while on the screen
  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const refresh = async () => {
      try {
        const data = await listMyDuels()
        if (!cancelled) {
          setDuels(data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    refresh()
    pollTimerRef.current = setInterval(refresh, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [userId])

  // If user is not opt-in, show prompt
  if (!optedInRanking) {
    return (
      <div className="bg-dark text-white pb-32 min-h-screen-content">
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          <div className="evo-card relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-tactical" />
            <div className="p-6">
              <div className="text-[10px] tracking-[0.2em] text-orange-tactical uppercase border border-orange-tactical/30 inline-block px-2 py-1 mb-3 font-mono">
                Acesso restrito
              </div>
              <h1 className="text-3xl font-display uppercase tracking-wide leading-none mb-3">
                Entre no <span className="text-orange-tactical">Ranking</span>
              </h1>
              <div className="text-xs text-stone-300 leading-relaxed mb-4">
                Duelos sancionados são exclusivos pra usuários cadastrados que aceitam aparecer no ranking. Isso garante que vitórias e derrotas contam pra todos os envolvidos.
              </div>
              <button
                onClick={onToggleOptIn}
                className="w-full px-4 py-3 bg-orange-tactical text-black font-bold tracking-wider uppercase text-sm rounded-md hover:opacity-90 transition active:scale-[0.98] font-mono"
              >
                Ativar ranking e duelos
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'create') {
    return (
      <CreateDuelView
        userId={userId}
        acervo={acervo}
        club={club}
        onCancel={() => setView('list')}
        onCreated={(duelId) => {
          setActiveDuelId(duelId)
          setView('list')
          // Refresh immediately
          listMyDuels().then(setDuels)
        }}
      />
    )
  }

  if (view === 'duel' && activeDuelId) {
    const duel = duels.find((d) => d.id === activeDuelId)
    if (!duel) {
      // Duel disappeared, go back
      return (
        <div className="bg-dark text-white pb-32 min-h-screen-content">
          <div className="max-w-2xl mx-auto px-4 py-5">
            <div className="evo-card p-6">
              <div className="text-sm text-stone-300">Duelo não encontrado.</div>
              <button onClick={() => { setView('list'); setActiveDuelId(null) }} className="mt-3 text-xs text-orange-tactical underline">Voltar</button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <DuelView
        duel={duel}
        userId={userId}
        userDisplayName={userDisplayName}
        onBack={() => { setView('list'); setActiveDuelId(null) }}
        onUpdate={() => listMyDuels().then(setDuels)}
      />
    )
  }

  // ============ LIST VIEW ============

  const pendingIncoming = duels.filter((d) => d.status === 'pending' && d.iAm === 'opponent')
  const pendingOutgoing = duels.filter((d) => d.status === 'pending' && d.iAm === 'challenger')
  const active = duels.filter((d) => d.status === 'active')
  const history = duels.filter((d) => ['completed', 'declined', 'expired', 'cancelled'].includes(d.status))

  const wins = history.filter((d) => d.winner && ((d.winner === 'challenger' && d.iAm === 'challenger') || (d.winner === 'opponent' && d.iAm === 'opponent'))).length
  const losses = history.filter((d) => d.winner && d.winner !== 'tie' && !((d.winner === 'challenger' && d.iAm === 'challenger') || (d.winner === 'opponent' && d.iAm === 'opponent')) && d.status === 'completed').length
  const ties = history.filter((d) => d.winner === 'tie').length

  return (
    <div className="bg-dark text-white pb-32 min-h-screen-content">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {/* Header */}
        <div className="evo-card relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-tactical" />
          <div className="p-6">
            <div className="text-[10px] tracking-[0.2em] text-orange-tactical uppercase border border-orange-tactical/30 inline-block px-2 py-1 mb-3 font-mono">
              Head to Head · ao vivo
            </div>
            <h1 className="text-3xl font-display uppercase tracking-wide leading-none mb-2">
              Duelo <span className="text-red-tactical">1v1</span>
            </h1>
            <div className="text-[11px] tracking-[0.1em] text-stone-400 uppercase">
              12 tiros · 3 por quadrante · 10 min pra aceitar
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <StatBox label="Vitórias" value={wins} color="orange" />
          <StatBox label="Derrotas" value={losses} color="red" />
          <StatBox label="Empates" value={ties} color="stone" />
        </div>

        {/* New challenge */}
        <button
          onClick={() => setView('create')}
          disabled={!club?.name}
          className="w-full px-4 py-4 bg-orange-tactical text-black font-bold tracking-wider uppercase text-sm rounded-md hover:opacity-90 transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed font-mono"
        >
          {club?.name ? 'Iniciar novo duelo' : 'Selecione um clube primeiro'}
        </button>

        {error && (
          <div className="evo-card border border-red-tactical/40 p-3">
            <div className="text-xs text-red-tactical">{error}</div>
          </div>
        )}

        {/* Incoming pending - URGENT */}
        {pendingIncoming.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] tracking-[0.18em] uppercase text-orange-tactical font-mono">
              Desafios recebidos
            </div>
            {pendingIncoming.map((d) => (
              <IncomingDuelCard
                key={d.id}
                duel={d}
                onOpen={() => { setActiveDuelId(d.id); setView('duel') }}
              />
            ))}
          </div>
        )}

        {/* Active */}
        {active.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] tracking-[0.18em] uppercase text-stone-300 font-mono">
              Duelos em andamento
            </div>
            {active.map((d) => (
              <ActiveDuelCard
                key={d.id}
                duel={d}
                onOpen={() => { setActiveDuelId(d.id); setView('duel') }}
              />
            ))}
          </div>
        )}

        {/* Outgoing pending */}
        {pendingOutgoing.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 font-mono">
              Aguardando resposta
            </div>
            {pendingOutgoing.map((d) => (
              <OutgoingDuelCard
                key={d.id}
                duel={d}
                onOpen={() => { setActiveDuelId(d.id); setView('duel') }}
              />
            ))}
          </div>
        )}

        {loading && (
          <div className="evo-card p-8 text-center">
            <Spinner />
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-2 pt-3">
            <div className="text-[10px] tracking-[0.18em] uppercase text-stone-500 font-mono">
              Histórico
            </div>
            <div className="evo-card divide-y divide-white/5">
              {history.map((d) => (
                <HistoryRow key={d.id} duel={d} onOpen={() => { setActiveDuelId(d.id); setView('duel') }} />
              ))}
            </div>
          </div>
        )}

        {!loading && duels.length === 0 && (
          <div className="evo-card p-8 text-center">
            <div className="text-sm font-light">Nenhum duelo registrado ainda</div>
            <div className="text-[11px] text-stone-400 mt-1">Crie seu primeiro desafio acima.</div>
          </div>
        )}
      </div>
    </div>
  )
}

// =================== CREATE DUEL ===================

function CreateDuelView({ userId, acervo, club, onCancel, onCreated }) {
  const [opponents, setOpponents] = useState([])
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedOpponent, setSelectedOpponent] = useState(null)
  const [arma, setArma] = useState('')
  const [calibre, setCalibre] = useState('')
  const [distancia, setDistancia] = useState('')
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  // Initial search
  useEffect(() => {
    let cancelled = false
    setSearching(true)
    findDuelOpponents(club.name, query)
      .then((data) => { if (!cancelled) { setOpponents(data); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [query, club.name])

  const handleCreate = async () => {
    if (!selectedOpponent) { setError('Selecione um oponente'); return }
    if (!arma) { setError('Selecione a arma'); return }
    if (!calibre) { setError('Selecione o calibre'); return }
    setError(null)
    setCreating(true)
    try {
      const duelId = await createDuel({
        opponentId: selectedOpponent.id,
        club,
        arma,
        calibre,
        distancia: distancia ? parseFloat(distancia) : null,
      })
      onCreated(duelId)
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="bg-dark text-white pb-32 min-h-screen-content">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <BackHeader onBack={onCancel} title="Novo duelo" />

        <div className="evo-card p-4">
          <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 mb-1.5 font-mono">
            No clube
          </div>
          <div className="text-sm text-white">{club.name}</div>
          <div className="text-[10px] text-stone-500 mt-2 leading-relaxed">
            Só aparecem oponentes que também estão neste clube e ativaram o ranking.
          </div>
        </div>

        {/* Opponent search */}
        <div className="evo-card p-4 space-y-3">
          <div>
            <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 mb-1.5 font-mono">
              Oponente
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou email…"
              className="w-full px-3 py-2.5 bg-black/40 border border-white/15 rounded-md text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-tactical"
            />
          </div>

          {searching ? (
            <div className="py-4 text-center"><Spinner /></div>
          ) : opponents.length === 0 ? (
            <div className="text-center py-4">
              <div className="text-xs text-stone-400">
                {query
                  ? 'Nenhum atirador encontrado com esse nome.'
                  : 'Ninguém disponível pra duelo neste clube ainda.'}
              </div>
              <div className="text-[10px] text-stone-500 mt-1">
                Oponentes precisam estar com este clube selecionado e ativar o ranking.
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {opponents.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSelectedOpponent(o)}
                  className={`w-full text-left p-3 rounded-md border transition ${
                    selectedOpponent?.id === o.id
                      ? 'bg-orange-tactical/20 border-orange-tactical'
                      : 'bg-black/40 border-white/10 hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{o.displayName}</div>
                      <div className="text-[10px] text-stone-500 truncate">{o.email}</div>
                    </div>
                    {o.challengeWins > 0 && (
                      <span className="flex-shrink-0 bg-orange-tactical/20 border border-orange-tactical/40 text-orange-tactical text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded font-mono">
                        {o.challengeWins}W
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Arma + Calibre */}
        <div className="evo-card p-4 space-y-3">
          <div>
            <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 mb-1.5 font-mono">
              Arma
            </div>
            <select
              value={arma}
              onChange={(e) => {
                setArma(e.target.value)
                const found = acervo.find((a) => a.arma === e.target.value)
                if (found) setCalibre(found.calibre)
              }}
              className="w-full px-3 py-2.5 bg-black/40 border border-white/15 rounded-md text-sm text-white focus:outline-none focus:border-orange-tactical"
            >
              <option value="">Selecione...</option>
              {acervo.map((a) => (
                <option key={a.id} value={a.arma}>{a.arma} · {a.calibre}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 mb-1.5 font-mono">
                Calibre
              </div>
              <select
                value={calibre}
                onChange={(e) => setCalibre(e.target.value)}
                className="w-full px-3 py-2.5 bg-black/40 border border-white/15 rounded-md text-sm text-white focus:outline-none focus:border-orange-tactical"
              >
                <option value="">Selecione...</option>
                {CALIBRES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 mb-1.5 font-mono">
                Distância (opcional)
              </div>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  value={distancia}
                  onChange={(e) => setDistancia(e.target.value)}
                  placeholder="ex: 25"
                  className="w-full px-3 py-2.5 pr-9 bg-black/40 border border-white/15 rounded-md text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-tactical"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-500 pointer-events-none">m</span>
              </div>
            </div>
          </div>

          <div className="bg-black/40 border border-orange-tactical/30 rounded-md p-3">
            <div className="text-[10px] tracking-[0.18em] uppercase text-orange-tactical mb-1 font-mono">Regra do duelo</div>
            <div className="text-xs text-stone-300 leading-relaxed">
              <strong>12 tiros</strong>, <strong>3 em cada quadrante</strong>. Oponente tem <strong>10 minutos</strong> pra aceitar.
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-tactical/20 border border-red-tactical/40 rounded-md p-2.5">
              {error}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creating || !selectedOpponent || !arma || !calibre}
            className="w-full px-4 py-3 bg-orange-tactical text-black font-bold tracking-wider uppercase text-sm rounded-md hover:opacity-90 transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed font-mono"
          >
            {creating ? 'Criando…' : 'Enviar desafio'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =================== DUEL VIEW (active duel screen) ===================

function DuelView({ duel, userId, userDisplayName, onBack, onUpdate }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [remaining, setRemaining] = useState(formatRemaining(duel.expiresAt))

  // Countdown timer for pending duels
  useEffect(() => {
    if (duel.status !== 'pending') return
    const t = setInterval(() => {
      setRemaining(formatRemaining(duel.expiresAt))
    }, 1000)
    return () => clearInterval(t)
  }, [duel.expiresAt, duel.status])

  const iAmChallenger = duel.iAm === 'challenger'
  const mySubmitted = iAmChallenger ? duel.challengerSubmitted : duel.opponentSubmitted
  const theirSubmitted = iAmChallenger ? duel.opponentSubmitted : duel.challengerSubmitted
  const otherName = iAmChallenger ? duel.opponentName : duel.challengerName

  const handleAction = async (fn, ...args) => {
    setError(null)
    setBusy(true)
    try {
      await fn(...args)
      onUpdate()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handlePhoto = async (file) => {
    if (!file) return
    setError(null)
    try {
      const dataUrl = await fileToDataUrl(file)
      const compressed = await compressImage(dataUrl)
      setPhoto(compressed)
      setAnalysis(null)
    } catch (e) {
      setError('Erro ao carregar foto: ' + e.message)
    }
  }

  const handleAnalyze = async () => {
    if (!photo) return
    setError(null)
    setAnalyzing(true)
    try {
      const result = await analyzeTarget({
        photo,
        arma: duel.arma,
        calibre: duel.calibre,
        expectedShots: EXPECTED_SHOTS,
        distancia: duel.distancia,
      })
      setAnalysis(result)
    } catch (e) {
      setError('Erro ao analisar: ' + e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSubmit = async () => {
    if (!analysis || !photo) return
    setError(null)
    setSubmitting(true)
    try {
      const photoPath = await uploadChallengePhoto(userId, photo)
      await submitDuelResult(duel.id, {
        pontos: analysis.pontos,
        disparos: analysis.disparos,
        quadrantes: analysis.quadrantes,
        photoPath,
      })
      onUpdate()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ====== STATUS DISPATCH ======

  // PENDING + opponent (incoming) -> accept/decline
  if (duel.status === 'pending' && !iAmChallenger) {
    return (
      <div className="bg-dark text-white pb-32 min-h-screen-content">
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          <BackHeader onBack={onBack} title="Desafio recebido" />

          <div className="evo-card relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-tactical" />
            <div className="p-6">
              <div className="text-[10px] tracking-[0.18em] uppercase text-orange-tactical font-mono mb-2">
                de {duel.challengerName}
              </div>
              <h1 className="text-2xl font-display uppercase tracking-wide leading-tight mb-3">
                Você foi desafiado
              </h1>
              <DuelSpec duel={duel} />
              <CountdownBox remaining={remaining} label="Tempo pra aceitar" />
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-tactical/20 border border-red-tactical/40 rounded-md p-2.5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleAction(declineDuel, duel.id)}
              disabled={busy}
              className="px-4 py-3 bg-white/10 border border-white/20 hover:bg-white/15 text-xs font-bold tracking-wider uppercase rounded-md transition disabled:opacity-50 font-mono"
            >
              Recusar
            </button>
            <button
              onClick={() => handleAction(acceptDuel, duel.id)}
              disabled={busy}
              className="px-4 py-3 bg-orange-tactical text-black font-bold tracking-wider uppercase text-xs rounded-md hover:opacity-90 transition disabled:opacity-50 font-mono"
            >
              Aceitar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // PENDING + challenger (outgoing) -> wait/cancel
  if (duel.status === 'pending' && iAmChallenger) {
    return (
      <div className="bg-dark text-white pb-32 min-h-screen-content">
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          <BackHeader onBack={onBack} title="Aguardando resposta" />

          <div className="evo-card relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-stone-400" />
            <div className="p-6 text-center">
              <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 font-mono mb-2">
                desafiando
              </div>
              <h1 className="text-2xl font-display uppercase tracking-wide leading-tight mb-3">
                {duel.opponentName}
              </h1>
              <DuelSpec duel={duel} />
              <CountdownBox remaining={remaining} label="Aguardando aceite" />
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-tactical/20 border border-red-tactical/40 rounded-md p-2.5">
              {error}
            </div>
          )}

          <button
            onClick={() => handleAction(cancelDuel, duel.id)}
            disabled={busy}
            className="w-full px-4 py-3 bg-white/10 border border-white/20 hover:bg-white/15 text-xs font-bold tracking-wider uppercase rounded-md transition disabled:opacity-50 font-mono"
          >
            Cancelar desafio
          </button>
        </div>
      </div>
    )
  }

  // ACTIVE
  if (duel.status === 'active') {
    return (
      <div className="bg-dark text-white pb-32 min-h-screen-content">
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          <BackHeader onBack={onBack} title="Duelo em andamento" />

          <div className="evo-card p-5">
            <div className="text-[10px] tracking-[0.18em] uppercase text-orange-tactical font-mono mb-1">
              vs {otherName}
            </div>
            <DuelSpec duel={duel} />
          </div>

          {/* Progress */}
          <div className="evo-card p-4">
            <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 font-mono mb-3">
              Status dos atiradores
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ShooterStatus
                name={iAmChallenger ? (userDisplayName || 'Você') : duel.challengerName}
                isYou={iAmChallenger}
                submitted={duel.challengerSubmitted}
                pontos={duel.challengerPontos}
              />
              <ShooterStatus
                name={iAmChallenger ? duel.opponentName : (userDisplayName || 'Você')}
                isYou={!iAmChallenger}
                submitted={duel.opponentSubmitted}
                pontos={duel.opponentPontos}
              />
            </div>
          </div>

          {/* Submit area or waiting */}
          {mySubmitted ? (
            <div className="evo-card p-5 text-center">
              <div className="text-sm text-stone-300 mb-1">Resultado enviado.</div>
              <div className="text-[11px] text-stone-500">
                {theirSubmitted ? 'Aguarde os dois resultados...' : `Aguardando ${otherName}`}
              </div>
              <div className="mt-3">
                <Spinner />
              </div>
            </div>
          ) : (
            <div className="evo-card p-4 space-y-3">
              <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 font-mono">
                Sua vez de atirar
              </div>

              {photo ? (
                <div className="relative rounded-md overflow-hidden border border-white/10 bg-black">
                  <img src={photo} alt="" className="w-full max-h-72 object-contain" />
                  <label className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white text-[10px] tracking-wider uppercase px-2 py-1 rounded cursor-pointer hover:bg-black/90 font-mono">
                    trocar
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handlePhoto(e.target.files?.[0])}
                    />
                  </label>
                </div>
              ) : (
                <label className="block w-full py-8 border-2 border-dashed border-white/15 rounded-md cursor-pointer hover:border-white/30 text-center transition">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handlePhoto(e.target.files?.[0])}
                  />
                  <div className="text-sm text-stone-300 font-light">Foto do alvo</div>
                  <div className="text-[10px] text-stone-500 mt-1 font-mono">12 tiros · 3 por quadrante</div>
                </label>
              )}

              {photo && !analysis && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="w-full px-3 py-2.5 bg-white/10 hover:bg-white/15 border border-white/20 text-xs font-bold tracking-wider uppercase rounded-md disabled:opacity-50 transition font-mono"
                >
                  {analyzing ? 'Analisando…' : 'Analisar alvo'}
                </button>
              )}

              {analysis && (
                <>
                  <div className="bg-black/40 border border-white/10 rounded-md p-3 space-y-2">
                    <div className="flex items-baseline gap-2">
                      <div className="text-2xl font-display font-bold text-white">{analysis.pontos}</div>
                      <div className="text-[10px] text-stone-400 tracking-wider uppercase font-mono">pontos · {analysis.disparos} disparos</div>
                    </div>
                    {(analysis.resumo || analysis.diagnostico) && (
                      <div className="text-[11px] text-stone-300 leading-relaxed border-t border-white/10 pt-2">
                        {analysis.resumo || analysis.diagnostico}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="w-full px-4 py-3 bg-orange-tactical text-black font-bold tracking-wider uppercase text-sm rounded-md hover:opacity-90 transition disabled:opacity-50 font-mono"
                  >
                    {submitting ? 'Enviando…' : 'Confirmar resultado'}
                  </button>
                </>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-tactical/20 border border-red-tactical/40 rounded-md p-2.5">
              {error}
            </div>
          )}
        </div>
      </div>
    )
  }

  // COMPLETED / DECLINED / EXPIRED / CANCELLED -> result/info
  return (
    <div className="bg-dark text-white pb-32 min-h-screen-content">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <BackHeader onBack={onBack} title="Resultado do duelo" />
        <ResultView duel={duel} userDisplayName={userDisplayName} />
      </div>
    </div>
  )
}

// =================== RESULT ===================

function ResultView({ duel, userDisplayName }) {
  const iAmChallenger = duel.iAm === 'challenger'
  const myPontos = iAmChallenger ? duel.challengerPontos : duel.opponentPontos
  const theirPontos = iAmChallenger ? duel.opponentPontos : duel.challengerPontos
  const myName = iAmChallenger ? (userDisplayName || duel.challengerName) : (userDisplayName || duel.opponentName)
  const theirName = iAmChallenger ? duel.opponentName : duel.challengerName

  if (duel.status === 'declined') {
    return (
      <div className="evo-card p-6 text-center">
        <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 font-mono mb-2">Recusado</div>
        <div className="text-lg font-display uppercase tracking-wide mb-2">
          {iAmChallenger ? `${theirName} recusou` : 'Você recusou'}
        </div>
        <DuelSpec duel={duel} />
      </div>
    )
  }

  if (duel.status === 'expired') {
    return (
      <div className="evo-card p-6 text-center">
        <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 font-mono mb-2">Expirado</div>
        <div className="text-lg font-display uppercase tracking-wide mb-2">Sem resposta em 10 minutos</div>
        <DuelSpec duel={duel} />
      </div>
    )
  }

  if (duel.status === 'cancelled') {
    return (
      <div className="evo-card p-6 text-center">
        <div className="text-[10px] tracking-[0.18em] uppercase text-stone-400 font-mono mb-2">Cancelado</div>
        <div className="text-lg font-display uppercase tracking-wide mb-2">Desafio cancelado</div>
        <DuelSpec duel={duel} />
      </div>
    )
  }

  // completed
  const youWon = (duel.winner === 'challenger' && iAmChallenger) || (duel.winner === 'opponent' && !iAmChallenger)
  const tie = duel.winner === 'tie'

  return (
    <>
      <div className="evo-card relative overflow-hidden">
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${youWon ? 'bg-orange-tactical' : tie ? 'bg-stone-400' : 'bg-red-tactical'}`} />
        <div className="p-6 text-center">
          <div className="text-[10px] tracking-[0.2em] uppercase mb-2 font-mono opacity-70">Resultado</div>
          {tie ? (
            <>
              <h1 className="text-4xl font-display uppercase tracking-wide leading-none mb-2 text-stone-300">EMPATE</h1>
              <div className="text-[11px] tracking-[0.15em] uppercase text-stone-400">Pontuações idênticas</div>
            </>
          ) : youWon ? (
            <>
              <h1 className="text-4xl font-display uppercase tracking-wide leading-none mb-2 text-orange-tactical">VITÓRIA</h1>
              <div className="text-[11px] tracking-[0.15em] uppercase text-stone-300">+1 no contador</div>
            </>
          ) : (
            <>
              <h1 className="text-4xl font-display uppercase tracking-wide leading-none mb-2 text-red-tactical">DERROTA</h1>
              <div className="text-[11px] tracking-[0.15em] uppercase text-stone-400">Próxima vez</div>
            </>
          )}
        </div>
      </div>

      <div className="evo-card p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <div className={`text-center ${youWon ? 'text-orange-tactical' : 'text-stone-300'}`}>
            <div className="text-[10px] tracking-wider uppercase text-stone-400 font-mono mb-1">{myName}</div>
            <div className={`text-5xl font-display font-bold ${youWon ? 'text-orange-tactical' : ''}`}>{myPontos}</div>
          </div>
          <div className="text-stone-500 font-mono">VS</div>
          <div className={`text-center ${!youWon && !tie ? 'text-red-tactical' : 'text-stone-300'}`}>
            <div className="text-[10px] tracking-wider uppercase text-stone-400 font-mono mb-1">{theirName}</div>
            <div className={`text-5xl font-display font-bold ${!youWon && !tie ? 'text-red-tactical' : ''}`}>{theirPontos}</div>
          </div>
        </div>
      </div>

      <div className="evo-card p-4">
        <DuelSpec duel={duel} />
      </div>

      {duel.challengerQuadrantes && duel.opponentQuadrantes && (
        <div className="evo-card p-4">
          <div className="text-[10px] tracking-[0.15em] uppercase text-stone-500 mb-3 font-mono">Análise por quadrante</div>
          <QuadrantsCompare
            leftName={iAmChallenger ? myName : duel.challengerName}
            leftIsMe={iAmChallenger}
            leftQs={duel.challengerQuadrantes}
            rightName={iAmChallenger ? duel.opponentName : myName}
            rightIsMe={!iAmChallenger}
            rightQs={duel.opponentQuadrantes}
          />
        </div>
      )}
    </>
  )
}

// =================== HELPERS / CARDS ===================

function DuelSpec({ duel }) {
  return (
    <div className="text-xs text-stone-300 leading-relaxed">
      <span className="text-orange-tactical font-semibold">{duel.arma}</span> · {duel.calibre}
      {duel.distancia && <> · {duel.distancia}m</>}
      {duel.clubName && <><br /><span className="text-stone-500">{duel.clubName}</span></>}
    </div>
  )
}

function CountdownBox({ remaining, label }) {
  return (
    <div className="mt-4 bg-black/40 border border-orange-tactical/30 rounded-md px-4 py-3 inline-block">
      <div className="text-[9px] tracking-wider uppercase text-stone-400 font-mono">{label}</div>
      <div className="text-3xl font-display font-bold text-orange-tactical font-mono">{remaining}</div>
    </div>
  )
}

function BackHeader({ onBack, title }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onBack} className="text-xs text-stone-400 hover:text-white underline">voltar</button>
      <div className="text-[11px] tracking-[0.18em] uppercase text-stone-300 font-mono">{title}</div>
    </div>
  )
}

function StatBox({ label, value, color }) {
  const map = {
    orange: 'text-orange-tactical',
    red: 'text-red-tactical',
    stone: 'text-stone-300',
  }
  return (
    <div className="evo-card p-4">
      <div className="text-[9px] tracking-[0.18em] text-stone-400 uppercase mb-1 font-mono">{label}</div>
      <div className={`text-3xl font-display font-semibold ${map[color] || 'text-white'}`}>{value}</div>
    </div>
  )
}

function IncomingDuelCard({ duel, onOpen }) {
  const [remaining, setRemaining] = useState(formatRemaining(duel.expiresAt))
  useEffect(() => {
    const t = setInterval(() => setRemaining(formatRemaining(duel.expiresAt)), 1000)
    return () => clearInterval(t)
  }, [duel.expiresAt])

  return (
    <button
      onClick={onOpen}
      className="w-full text-left evo-card border border-orange-tactical p-4 hover:bg-orange-tactical/10 transition"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] tracking-[0.15em] uppercase text-orange-tactical font-mono mb-1">desafiado por</div>
          <div className="text-base font-semibold truncate">{duel.challengerName}</div>
          <div className="text-[11px] text-stone-400 mt-1">{duel.arma} · {duel.calibre}{duel.distancia ? ` · ${duel.distancia}m` : ''}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[9px] tracking-wider uppercase text-stone-400 font-mono">restam</div>
          <div className="text-lg font-display font-bold text-orange-tactical font-mono">{remaining}</div>
        </div>
      </div>
    </button>
  )
}

function ActiveDuelCard({ duel, onOpen }) {
  const iAmChallenger = duel.iAm === 'challenger'
  const mySubmitted = iAmChallenger ? duel.challengerSubmitted : duel.opponentSubmitted
  const otherName = iAmChallenger ? duel.opponentName : duel.challengerName

  return (
    <button onClick={onOpen} className="w-full text-left evo-card p-4 hover:bg-white/5 transition">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] tracking-[0.15em] uppercase text-stone-300 font-mono mb-1">vs {otherName}</div>
          <div className="text-sm">
            {mySubmitted
              ? <span className="text-stone-400">Aguardando oponente atirar</span>
              : <span className="text-orange-tactical font-semibold">Sua vez de atirar</span>}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">{duel.arma} · {duel.calibre}</div>
        </div>
        <div className="text-orange-tactical text-xl">›</div>
      </div>
    </button>
  )
}

function OutgoingDuelCard({ duel, onOpen }) {
  const [remaining, setRemaining] = useState(formatRemaining(duel.expiresAt))
  useEffect(() => {
    const t = setInterval(() => setRemaining(formatRemaining(duel.expiresAt)), 1000)
    return () => clearInterval(t)
  }, [duel.expiresAt])

  return (
    <button onClick={onOpen} className="w-full text-left evo-card p-4 hover:bg-white/5 transition">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] tracking-[0.15em] uppercase text-stone-400 font-mono mb-1">desafiando</div>
          <div className="text-sm font-semibold truncate">{duel.opponentName}</div>
          <div className="text-[11px] text-stone-500 mt-1">{duel.arma} · {duel.calibre}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[9px] tracking-wider uppercase text-stone-500 font-mono">expira em</div>
          <div className="text-base font-display font-bold text-stone-300 font-mono">{remaining}</div>
        </div>
      </div>
    </button>
  )
}

function HistoryRow({ duel, onOpen }) {
  const iAmChallenger = duel.iAm === 'challenger'
  const myPontos = iAmChallenger ? duel.challengerPontos : duel.opponentPontos
  const theirPontos = iAmChallenger ? duel.opponentPontos : duel.challengerPontos
  const otherName = iAmChallenger ? duel.opponentName : duel.challengerName
  const date = new Date(duel.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

  const youWon = duel.status === 'completed' && ((duel.winner === 'challenger' && iAmChallenger) || (duel.winner === 'opponent' && !iAmChallenger))
  const tie = duel.winner === 'tie'

  let statusBadge
  if (duel.status === 'completed') {
    statusBadge = tie
      ? <span className="text-stone-400 font-bold font-mono text-[10px] tracking-wider">EMPATE</span>
      : youWon
        ? <span className="text-orange-tactical font-bold font-mono text-[10px] tracking-wider">VITÓRIA</span>
        : <span className="text-red-tactical font-bold font-mono text-[10px] tracking-wider">DERROTA</span>
  } else if (duel.status === 'declined') {
    statusBadge = <span className="text-stone-500 font-mono text-[10px] tracking-wider">RECUSADO</span>
  } else if (duel.status === 'expired') {
    statusBadge = <span className="text-stone-500 font-mono text-[10px] tracking-wider">EXPIROU</span>
  } else if (duel.status === 'cancelled') {
    statusBadge = <span className="text-stone-500 font-mono text-[10px] tracking-wider">CANCELADO</span>
  }

  return (
    <button onClick={onOpen} className="w-full text-left p-4 hover:bg-white/5 transition">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[10px] tracking-[0.15em] uppercase text-stone-500 font-mono">{date}</div>
        {statusBadge}
      </div>
      {duel.status === 'completed' ? (
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <div className={`text-right ${youWon ? 'text-orange-tactical' : 'text-stone-300'}`}>
            <div className="text-xs font-semibold truncate">Você</div>
            <div className="text-2xl font-display font-bold">{myPontos}</div>
          </div>
          <div className="text-stone-500 font-mono text-xs">VS</div>
          <div className={`${!youWon && !tie ? 'text-red-tactical' : 'text-stone-300'}`}>
            <div className="text-xs font-semibold truncate">{otherName}</div>
            <div className="text-2xl font-display font-bold">{theirPontos}</div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-stone-400">vs {otherName}</div>
      )}
      <div className="text-[10px] text-stone-500 font-mono mt-2">
        {duel.arma} · {duel.calibre}{duel.distancia ? ` · ${duel.distancia}m` : ''}
      </div>
    </button>
  )
}

function ShooterStatus({ name, isYou, submitted, pontos }) {
  return (
    <div className={`p-3 rounded-md border ${submitted ? 'bg-orange-tactical/10 border-orange-tactical/30' : 'bg-black/40 border-white/10'}`}>
      <div className="text-[10px] tracking-wider uppercase text-stone-400 font-mono truncate">
        {name}{isYou && <span className="text-orange-tactical"> · você</span>}
      </div>
      {submitted ? (
        <>
          <div className="text-xl font-display font-bold text-orange-tactical mt-1">{pontos}</div>
          <div className="text-[9px] text-stone-500 font-mono tracking-wider uppercase">enviado</div>
        </>
      ) : (
        <>
          <div className="text-xl font-display font-bold text-stone-500 mt-1">—</div>
          <div className="text-[9px] text-stone-500 font-mono tracking-wider uppercase">pendente</div>
        </>
      )}
    </div>
  )
}

function QuadrantTag({ label, desc, color }) {
  const colorClass = {
    yellow: 'border-l-yellow-500',
    green: 'border-l-green-500',
    red: 'border-l-red-500',
    blue: 'border-l-blue-500',
  }[color]
  return (
    <div className={`bg-black/30 border-l-2 ${colorClass} pl-2 py-1`}>
      <div className="text-[9px] tracking-wider uppercase text-stone-400 font-mono">{label}</div>
      <div className="text-[10px] text-stone-200 leading-tight mt-0.5">{desc || '—'}</div>
    </div>
  )
}

function QuadrantsCompare({ leftName, leftIsMe, leftQs, rightName, rightIsMe, rightQs }) {
  const quads = [
    { key: 'amarelo', label: 'Amarelo', color: 'border-l-yellow-500' },
    { key: 'verde', label: 'Verde', color: 'border-l-green-500' },
    { key: 'vermelho', label: 'Vermelho', color: 'border-l-red-500' },
    { key: 'azul', label: 'Azul', color: 'border-l-blue-500' },
  ]
  return (
    <div className="space-y-3">
      {quads.map((q) => (
        <div key={q.key} className={`bg-black/30 border-l-2 ${q.color} pl-3 py-2`}>
          <div className="text-[10px] tracking-wider uppercase text-stone-400 font-mono mb-1.5">{q.label}</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <div className={`text-[9px] uppercase tracking-wider font-mono mb-0.5 ${leftIsMe ? 'text-orange-tactical' : 'text-red-tactical'}`}>{leftName}</div>
              <div className="text-stone-200">{leftQs[q.key] || '—'}</div>
            </div>
            <div>
              <div className={`text-[9px] uppercase tracking-wider font-mono mb-0.5 ${rightIsMe ? 'text-orange-tactical' : 'text-red-tactical'}`}>{rightName}</div>
              <div className="text-stone-200">{rightQs[q.key] || '—'}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
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
