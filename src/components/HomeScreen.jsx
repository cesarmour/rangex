import { useMemo } from 'react'

// Home pos-login: principais stats do usuario num formato visual.
// Tudo calculado dos treinos ja hidratados (list_trainings_light), sem
// chamada extra ao banco.

function computeStats(trainings) {
  let totalDisparos = 0
  let totalPontos = 0
  let totalSessoes = 0
  const porArma = new Map()
  const serie = [] // { date, ptsTiro } por treino

  const sorted = [...trainings].sort((a, b) => new Date(a.trainedAt) - new Date(b.trainedAt))
  for (const t of sorted) {
    let d = 0, p = 0
    for (const s of t.sessions || []) {
      const disp = Number(s.disparos) || 0
      const pts = Number(s.pontos) || 0
      if (disp <= 0) continue
      totalSessoes++
      d += disp
      p += pts
      if (s.arma) {
        const cur = porArma.get(s.arma) || 0
        porArma.set(s.arma, cur + disp)
      }
    }
    totalDisparos += d
    totalPontos += p
    if (d > 0) serie.push({ date: t.trainedAt, ptsTiro: p / d })
  }

  let best = null
  for (const pt of serie) {
    if (!best || pt.ptsTiro > best.ptsTiro) best = pt
  }

  let armaFav = null
  for (const [arma, disp] of porArma.entries()) {
    if (!armaFav || disp > armaFav.disparos) armaFav = { arma, disparos: disp }
  }

  const last = sorted.length ? sorted[sorted.length - 1] : null

  return {
    totalTreinos: trainings.length,
    totalSessoes,
    totalDisparos,
    totalPontos,
    avgPtsTiro: totalDisparos > 0 ? totalPontos / totalDisparos : 0,
    serie: serie.slice(-12),
    best,
    armaFav,
    lastTrainedAt: last?.trainedAt || null,
  }
}

function Sparkline({ serie }) {
  if (serie.length < 2) return null
  const W = 600, H = 120, PAD = 8
  const vals = serie.map((p) => p.ptsTiro)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const pts = serie.map((p, i) => ({
    x: PAD + (i / (serie.length - 1)) * (W - 2 * PAD),
    y: H - PAD - ((p.ptsTiro - min) / range) * (H - 2 * PAD),
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`
  const lastPt = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C9A24B" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#C9A24B" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkfill)" />
      <path d={line} fill="none" stroke="#C9A24B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastPt.x} cy={lastPt.y} r="5" fill="#C9A24B" />
    </svg>
  )
}

function fmtDay(iso) {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
}

export default function HomeScreen({ trainings, profile, userInfo, club, onNavigate }) {
  const stats = useMemo(() => computeStats(trainings), [trainings])
  const role = profile?.role || 'user'
  const firstName = (userInfo?.displayName || '').split(' ')[0] || 'atirador'

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      {/* Hero */}
      <div className="rounded-xl bg-navy text-white p-5 relative overflow-hidden border-b-2 border-gold">
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full border-[10px] border-white/5" />
        <div className="absolute -right-2 -top-2 w-20 h-20 rounded-full border-[6px] border-gold/10" />
        <div className="relative">
          <div className="text-[10px] tracking-[0.2em] uppercase text-gold font-semibold">Bem-vindo de volta</div>
          <div className="text-xl font-semibold mt-1 flex items-center gap-2 flex-wrap">
            <span>{firstName}</span>
            {role === 'admin' && (
              <span className="text-[9px] tracking-[0.1em] uppercase font-bold bg-gold text-navy px-1.5 py-0.5 rounded">admin</span>
            )}
            {(role === 'ro' || profile?.judge_badge) && role !== 'admin' && (
              <span className="text-[9px] tracking-[0.1em] uppercase font-semibold bg-gold/15 text-gold border border-gold/40 px-1.5 py-0.5 rounded">Árbitro/RO</span>
            )}
          </div>
          <div className="text-[11px] text-stone-300 mt-1">
            {club?.name || 'sem clube'} · último treino: {fmtDay(stats.lastTrainedAt)}
          </div>

          <div className="grid grid-cols-4 gap-2 mt-5 text-center">
            <HeroMetric label="Treinos" value={stats.totalTreinos} />
            <HeroMetric label="Disparos" value={stats.totalDisparos.toLocaleString('pt-BR')} />
            <HeroMetric label="Pontos" value={stats.totalPontos.toLocaleString('pt-BR')} />
            <HeroMetric label="Pts/Tiro" value={stats.avgPtsTiro.toFixed(2)} gold />
          </div>
        </div>
      </div>

      {/* Evolucao */}
      {stats.serie.length >= 2 && (
        <div className="card p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-xs tracking-[0.18em] uppercase text-gold font-semibold">Evolução</div>
            <div className="text-[10px] text-stone-400">pts/tiro · últimos {stats.serie.length} treinos</div>
          </div>
          <Sparkline serie={stats.serie} />
          <div className="flex justify-between text-[10px] text-stone-400 -mt-1">
            <span>{fmtDay(stats.serie[0].date)}</span>
            <span>{fmtDay(stats.serie[stats.serie.length - 1].date)}</span>
          </div>
        </div>
      )}

      {/* Destaques */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3 text-center">
          <div className="text-lg font-light text-navy">{stats.best ? stats.best.ptsTiro.toFixed(2) : '—'}</div>
          <div className="text-[9px] tracking-[0.12em] uppercase text-stone-400 mt-0.5">Melhor pts/tiro</div>
          {stats.best && <div className="text-[10px] text-stone-500 mt-0.5">{fmtDay(stats.best.date)}</div>}
        </div>
        <div className="card p-3 text-center">
          <div className="text-lg font-light text-navy truncate">{stats.armaFav?.arma || '—'}</div>
          <div className="text-[9px] tracking-[0.12em] uppercase text-stone-400 mt-0.5">Arma favorita</div>
          {stats.armaFav && <div className="text-[10px] text-stone-500 mt-0.5">{stats.armaFav.disparos.toLocaleString('pt-BR')} disparos</div>}
        </div>
        <div className="card p-3 text-center">
          <div className="text-lg font-light text-navy">{Number(profile?.challenge_wins || 0)}</div>
          <div className="text-[9px] tracking-[0.12em] uppercase text-stone-400 mt-0.5">Duelos vencidos</div>
          <div className="text-[10px] text-stone-500 mt-0.5">{stats.totalSessoes} sessões</div>
        </div>
      </div>

      {/* Acoes rapidas */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onNavigate('treino')}
          className="px-4 py-3.5 bg-navy text-white text-sm font-semibold rounded-md border-b-2 border-gold transition active:scale-[0.98]">
          novo treino
        </button>
        <button onClick={() => onNavigate('campeonato')}
          className="px-4 py-3.5 bg-white border border-navy text-navy text-sm font-semibold rounded-md hover:bg-stone-50 transition active:scale-[0.98]">
          campeonatos
        </button>
      </div>

      {stats.totalTreinos === 0 && (
        <div className="card p-5 text-center space-y-1">
          <div className="text-sm font-semibold text-navy">Seu painel nasce no primeiro treino</div>
          <div className="text-[11px] text-stone-500 leading-relaxed">
            Registre uma sessão na aba Treino: foto do alvo, detecção dos furos e pontuação automática. As stats aparecem aqui.
          </div>
        </div>
      )}
    </main>
  )
}

function HeroMetric({ label, value, gold = false }) {
  return (
    <div className="bg-white/5 rounded-md py-2.5 px-1">
      <div className={`text-base font-semibold ${gold ? 'text-gold' : 'text-white'}`}>{value}</div>
      <div className="text-[9px] tracking-[0.12em] uppercase text-stone-400 mt-0.5">{label}</div>
    </div>
  )
}
