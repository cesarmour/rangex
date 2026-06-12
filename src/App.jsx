import { useEffect, useState, useRef } from 'react'
import Header from './components/Header.jsx'
import SessionCard from './components/SessionCard.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import LoginScreen from './components/LoginScreen.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import EvolutionScreen from './components/EvolutionScreen.jsx'
import RankingScreen from './components/RankingScreen.jsx'
import AcervoScreen from './components/AcervoScreen.jsx'
import ChallengeScreen from './components/ChallengeScreen.jsx'
import ChampionshipScreen from './components/ChampionshipScreen.jsx'
import { DEFAULT_ACERVO, DEFAULT_PRECOS, DEFAULT_SETTINGS } from './lib/defaults.js'
import { isConfigured } from './lib/supabase.js'
import { getSession, onAuthChange, signOut } from './lib/auth.js'
import {
  loadProfile, updateProfile,
  loadAcervo, addAcervo, updateAcervo, deleteAcervo, seedDefaultAcervo,
  loadTrainings, saveTraining, deleteTraining, getTrainingFull,
  acceptJudgeInvite,
} from './lib/db.js'
import { analyzeTarget } from './lib/analyze.js'
import { buildResumo } from './lib/pdf/resumo.js'
import { buildCompleto } from './lib/pdf/completo.js'
import { buildCobranca } from './lib/pdf/cobranca.js'

function newSession() {
  return {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    armaId: '',
    arma: '',
    calibre: '',
    disparos: 0,
    pontos: 0,
    distancia: 0,
    photo: null,
    quadrantes: { amarelo: '', verde: '', vermelho: '', azul: '' },
    diagnostico: '',
    analyzed: false,
  }
}

function todayDateStr() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

// Convert a Date/ISO to the value format datetime-local expects (local timezone)
function toDateTimeLocal(date) {
  const d = date ? new Date(date) : new Date()
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

// Convert datetime-local string back to ISO (treating input as local time)
function fromDateTimeLocal(value) {
  if (!value) return new Date().toISOString()
  return new Date(value).toISOString()
}

const TABS = [
  { id: 'treino', label: 'Treino' },
  { id: 'acervo', label: 'Acervo' },
  { id: 'challenge', label: 'Duelo' },
  { id: 'campeonato', label: 'Campeonato' },
  { id: 'evolucao', label: 'Evolução' },
  { id: 'ranking', label: 'Ranking' },
]

export default function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [acervo, setAcervo] = useState([])
  const [trainings, setTrainings] = useState([])
  const [hydrated, setHydrated] = useState(false)
  const hydratedUserIdRef = useRef(null)

  const [precos, setPrecos] = useState(DEFAULT_PRECOS)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [club, setClub] = useState(null)
  const [changingClub, setChangingClub] = useState(false)
  const [sessions, setSessions] = useState([newSession()])
  const [trainingDateTime, setTrainingDateTime] = useState(() => toDateTimeLocal(new Date()))
  const [showSettings, setShowSettings] = useState(false)
  const [showTrainings, setShowTrainings] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [pdfs, setPdfs] = useState(null)
  const [saveFlash, setSaveFlash] = useState(false)
  const [batchAnalyzing, setBatchAnalyzing] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })
  const [batchErrors, setBatchErrors] = useState([])
  const [activeTab, setActiveTab] = useState('treino')

  useEffect(() => {
    if (!isConfigured) {
      setAuthChecked(true)
      return
    }
    getSession()
      .then((session) => {
        setUser(session?.user || null)
        setAuthChecked(true)
      })
      .catch((err) => {
        console.error('Erro ao recuperar sessão:', err)
        // Stale/corrupted session in storage - clear it
        try {
          Object.keys(localStorage).forEach((k) => {
            if (k.startsWith('sb-') || k.startsWith('supabase')) localStorage.removeItem(k)
          })
        } catch {}
        setUser(null)
        setAuthChecked(true)
      })
    const unsub = onAuthChange((u, event) => {
      // So troca a referencia de user quando o id realmente muda.
      // Eventos como TOKEN_REFRESHED, USER_UPDATED e INITIAL_SESSION chegam
      // com o mesmo usuario e nao podem re-disparar a hidratacao no meio do caminho.
      setUser((prev) => (prev?.id === u?.id ? prev : u))
      if (event === 'SIGNED_OUT') {
        setProfile(null)
        setAcervo([])
        setTrainings([])
        setSessions([newSession()])
        setClub(null)
        setHydrated(false)
        hydratedUserIdRef.current = null
        setActiveTab('treino')
      }
    })
    return unsub
  }, [])

  const [hydrationError, setHydrationError] = useState(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!user || !isConfigured) return
    // Hidrata uma unica vez por usuario. Rastrear pelo id (e nao por um
    // booleano de ref) elimina o estado preso: se a referencia de user mudasse
    // no meio da hidratacao, o effect re-rodava, o cleanup marcava cancelled e
    // o guard antigo abortava sem nunca armar o timeout nem concluir.
    if (hydratedUserIdRef.current === user.id) return

    let cancelled = false
    const HYDRATION_TIMEOUT_MS = 15000

    const withTimeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout em ${label}. Verifique sua conexão.`)), HYDRATION_TIMEOUT_MS)
        }),
      ])

    ;(async () => {
      try {
        setHydrationError(null)
        const p = await withTimeout(loadProfile(user.id), 'perfil')
        let userAcervo = await withTimeout(loadAcervo(user.id), 'acervo')
        if (userAcervo.length === 0) {
          await withTimeout(seedDefaultAcervo(DEFAULT_ACERVO), 'configuração inicial')
          userAcervo = await withTimeout(loadAcervo(user.id), 'acervo')
        }
        const userTrainings = await withTimeout(loadTrainings(user.id), 'treinos')
        if (cancelled) return
        setProfile(p)
        setAcervo(userAcervo)
        setTrainings(userTrainings)
        if (p?.club_name) {
          setClub({ name: p.club_name, address: p.club_address, placeId: p.club_place_id })
        }
        if (p?.precos && typeof p.precos === 'object' && Object.keys(p.precos).length > 0) {
          setPrecos({ ...DEFAULT_PRECOS, ...p.precos })
        }
        setSettings({
          pixKey: p?.pix_key || DEFAULT_SETTINGS.pixKey,
          pixMerchant: p?.pix_merchant || DEFAULT_SETTINGS.pixMerchant,
          pixCity: p?.pix_city || DEFAULT_SETTINGS.pixCity,
        })
        hydratedUserIdRef.current = user.id
        setHydrated(true)
      } catch (e) {
        if (cancelled) return
        console.error('Erro ao carregar dados:', e)
        setHydrationError(e.message || 'Erro desconhecido')
      }
    })()

    return () => { cancelled = true }
  }, [user, retryNonce])

  useEffect(() => {
    if (!user || !hydrated) return
    const t = setTimeout(() => {
      updateProfile(user.id, {
        club_name: club?.name || null,
        club_address: club?.address || null,
        club_place_id: club?.placeId || null,
        precos,
        pix_key: settings.pixKey || null,
        pix_merchant: settings.pixMerchant || null,
        pix_city: settings.pixCity || null,
      }).catch((e) => console.error('Erro ao salvar perfil:', e))
    }, 600)
    return () => clearTimeout(t)
  }, [user, hydrated, club, precos, settings])

  const [judgeInviteMsg, setJudgeInviteMsg] = useState(null)

  // Deep link do convite de Juiz de Prova/IAT (?juiz=TOKEN, enviado por WhatsApp).
  // Guarda o token no localStorage ANTES do login (sobrevive ao fluxo de criar
  // conta) e limpa a URL pra nao reprocessar.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const tok = params.get('juiz')
      if (tok) {
        localStorage.setItem('sra.judgeInvite', tok)
        params.delete('juiz')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
      }
    } catch {}
  }, [])

  // Logado e hidratado: aceita o convite pendente e vira juiz (com badge).
  useEffect(() => {
    if (!user || !hydrated) return
    let tok = null
    try { tok = localStorage.getItem('sra.judgeInvite') } catch {}
    if (!tok) return
    try { localStorage.removeItem('sra.judgeInvite') } catch {}
    acceptJudgeInvite(tok)
      .then((res) => {
        setJudgeInviteMsg({ ok: true, text: `Você agora é o Juiz de Prova/IAT de "${res?.name || 'campeonato'}". A auditoria fica na aba Campeonato.` })
        setActiveTab('campeonato')
      })
      .catch((e) => setJudgeInviteMsg({ ok: false, text: e.message || 'Erro ao aceitar convite de juiz' }))
  }, [user, hydrated])

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy">
        <Spinner size="10" />
      </div>
    )
  }

  if (!user) return <AuthScreen />

  if (!hydrated) {
    if (hydrationError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-navy text-white gap-4 p-6">
          <div className="max-w-sm w-full text-center space-y-5">
            <div className="text-base font-semibold text-gold">Não conseguimos carregar seus dados</div>
            <div className="text-sm text-stone-300 leading-relaxed">{hydrationError}</div>
            <div className="space-y-2 pt-2">
              <button
                onClick={() => { setHydrationError(null); setRetryNonce((n) => n + 1) }}
                className="w-full px-4 py-3 bg-gold text-navy text-sm font-bold tracking-wide rounded-md hover:opacity-90 transition active:scale-[0.98]"
              >
                Tentar novamente
              </button>
              <button
                onClick={async () => {
                  try { await signOut() } catch {}
                  try {
                    Object.keys(localStorage).forEach((k) => {
                      if (k.startsWith('sb-') || k.startsWith('supabase')) localStorage.removeItem(k)
                    })
                  } catch {}
                  window.location.reload()
                }}
                className="w-full px-4 py-3 bg-transparent border border-white/20 text-white text-sm font-semibold rounded-md hover:bg-white/5 transition"
              >
                Sair e entrar de novo
              </button>
            </div>
            <div className="text-[10px] text-stone-500 pt-2 leading-relaxed">
              Se o problema persistir, sua sessão pode estar com cache corrompido. O botão acima limpa e reinicia.
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-navy text-white gap-4">
        <Spinner size="8" />
        <div className="text-sm text-stone-300">Carregando seus dados…</div>
      </div>
    )
  }

  if (!club || changingClub) {
    return (
      <LoginScreen
        onSelect={(selected) => {
          setClub(selected)
          setChangingClub(false)
        }}
      />
    )
  }

  const userInfo = {
    email: user.email,
    displayName: profile?.display_name || user.email?.split('@')[0],
  }

  const totals = sessions.reduce(
    (acc, s) => ({
      disparos: acc.disparos + (s.disparos || 0),
      pontos: acc.pontos + (s.pontos || 0),
    }),
    { disparos: 0, pontos: 0 }
  )
  totals.ptsTiro = totals.disparos > 0 ? totals.pontos / totals.disparos : 0

  const sessionsPlatformCount = new Set(sessions.map((s) => s.arma).filter(Boolean)).size
  const validSessions = sessions.filter((s) => s.arma && s.disparos > 0)
  const canGenerate = validSessions.length > 0
  const hasData = sessions.some((s) => s.arma || s.disparos > 0 || s.photo)
  const pendingAnalysis = sessions.filter((s) => s.photo && s.arma && !s.analyzed)
  const analyzedCount = sessions.filter((s) => s.analyzed).length
  const canBatchAnalyze = pendingAnalysis.length > 0

  const agg = {}
  for (const s of validSessions) agg[s.calibre] = (agg[s.calibre] || 0) + s.disparos
  let totalPagar = 0
  for (const [cal, qty] of Object.entries(agg)) {
    totalPagar += qty * (precos[cal] ?? 0)
  }

  const handleAddAcervo = async () => {
    try {
      const newItem = await addAcervo(user.id, { arma: '', calibre: '9mm Luger', sortOrder: acervo.length })
      setAcervo([...acervo, newItem])
    } catch (e) { alert('Erro ao adicionar: ' + e.message) }
  }

  const handleUpdateAcervo = async (id, patch) => {
    setAcervo(acervo.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    try { await updateAcervo(id, patch) } catch (e) { console.error(e) }
  }

  const handleRemoveAcervo = async (id) => {
    setAcervo(acervo.filter((a) => a.id !== id))
    try { await deleteAcervo(id) } catch (e) { console.error(e) }
  }

  const toggleRanking = async () => {
    const newValue = !profile?.show_in_ranking
    setProfile({ ...profile, show_in_ranking: newValue })
    try {
      await updateProfile(user.id, { show_in_ranking: newValue })
    } catch (e) {
      setProfile({ ...profile, show_in_ranking: !newValue })
      alert('Erro ao atualizar: ' + e.message)
    }
  }

  const changeNickname = async (newNick) => {
    setProfile({ ...profile, nickname: newNick })
    try {
      await updateProfile(user.id, { nickname: newNick })
    } catch (e) {
      console.error(e)
    }
  }

  const addSession = () => setSessions([...sessions, newSession()])
  const updateSession = (id, updated) => setSessions(sessions.map((s) => (s.id === id ? updated : s)))
  const removeSession = (id) => setSessions(sessions.filter((s) => s.id !== id))

  const analyzeAllPending = async () => {
    if (pendingAnalysis.length === 0) return
    setBatchAnalyzing(true)
    setBatchErrors([])
    setBatchProgress({ current: 0, total: pendingAnalysis.length })
    const idsToAnalyze = pendingAnalysis.map((s) => s.id)
    const errors = []
    for (let i = 0; i < idsToAnalyze.length; i++) {
      const id = idsToAnalyze[i]
      setBatchProgress({ current: i + 1, total: idsToAnalyze.length })
      const current = sessions.find((s) => s.id === id)
      if (!current || !current.photo || !current.arma) continue
      try {
        const result = await analyzeTarget({
          photo: current.photo,
          arma: current.arma,
          calibre: current.calibre,
          expectedShots: current.disparos > 0 ? current.disparos : null,
          distancia: current.distancia > 0 ? current.distancia : null,
        })
        setSessions((prev) => prev.map((s) =>
          s.id === id
            ? { ...s, disparos: result.disparos, pontos: result.pontos, resumo: result.resumo, diagnostico: result.resumo, quadrantes: result.quadrantes, analyzed: true }
            : s
        ))
      } catch (e) {
        errors.push({ id, sessionIndex: sessions.findIndex((s) => s.id === id) + 1, message: e.message })
      }
    }
    setBatchErrors(errors)
    setBatchAnalyzing(false)
    setTimeout(() => setBatchProgress({ current: 0, total: 0 }), 2500)
  }

  const generateAll = async () => {
    setGenerating(true)
    setPdfs(null)
    try {
      const dateStr = todayDateStr()
      const sess = validSessions
      const resumoDoc = buildResumo({ sessions: sess, totals, sessionsPlatformCount, club })
      const completoDoc = await buildCompleto({ sessions: sess, totals, sessionsPlatformCount, precos, club })
      const cobrancaDoc = await buildCobranca({
        sessions: sess, totals, precos, club,
        pix: { key: settings.pixKey, merchant: settings.pixMerchant, city: settings.pixCity },
      })
      setPdfs({
        resumo: { doc: resumoDoc, name: `resumo_executivo_${dateStr}.pdf` },
        completo: { doc: completoDoc, name: `relatorio_completo_${dateStr}.pdf` },
        cobranca: { doc: cobrancaDoc, name: `cobranca_${dateStr}.pdf` },
      })
    } catch (e) {
      console.error(e)
      alert('Erro ao gerar relatórios: ' + e.message)
    } finally { setGenerating(false) }
  }

  const downloadPdf = (pdf) => {
    try { pdf.doc.save(pdf.name) } catch (e) { alert('Erro ao baixar: ' + e.message) }
  }

  const saveCurrentTraining = async () => {
    const sessionsToSave = validSessions.length > 0
      ? validSessions
      : sessions.filter((s) => s.arma || s.disparos > 0 || s.photo)
    if (sessionsToSave.length === 0) {
      alert('Nada pra salvar. Adicione uma sessão primeiro.')
      return
    }
    try {
      const trainedAtISO = fromDateTimeLocal(trainingDateTime)
      const trainedDate = new Date(trainedAtISO)
      const training = {
        label: trainedDate.toLocaleDateString('pt-BR') + ' · ' + trainedDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        trainedAt: trainedAtISO,
        club, sessions: sessionsToSave,
      }
      const saved = await saveTraining(user.id, training)
      setTrainings([saved, ...trainings])
      setSaveFlash(true)
      setTimeout(() => setSaveFlash(false), 1500)
    } catch (e) { alert('Erro ao salvar treino: ' + e.message) }
  }

  const loadTrainingFromHistory = async (id) => {
    const t = trainings.find((x) => x.id === id)
    if (!t) return
    if (hasData && !confirm('Carregar esse treino vai sobrescrever o atual. Continuar?')) return
    // A lista carrega leve (sem fotos). Aqui buscamos a versao completa,
    // com as fotos, so do treino que esta sendo aberto.
    let full = t
    try {
      const fetched = await getTrainingFull(id)
      if (fetched) full = fetched
    } catch (e) {
      console.error('Erro ao carregar treino completo:', e)
    }
    const restored = full.sessions.map((s) => ({
      ...s,
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      distancia: s.distancia || 0,
      quadrantes: s.quadrantes || { amarelo: '', verde: '', vermelho: '', azul: '' },
      analyzed: s.analyzed ?? Boolean(s.diagnostico),
    }))
    setSessions(restored)
    if (full.trainedAt) setTrainingDateTime(toDateTimeLocal(full.trainedAt))
    if (full.club) setClub(full.club)
    setShowTrainings(false)
    setPdfs(null)
  }

  const deleteTrainingFromHistory = async (id) => {
    if (!confirm('Apagar esse treino salvo?')) return
    setTrainings(trainings.filter((x) => x.id !== id))
    try { await deleteTraining(id) } catch (e) { console.error(e) }
  }

  const newTraining = () => {
    if (hasData && !confirm('Começar treino novo vai limpar a tela atual. Continuar?')) return
    setSessions([newSession()])
    setTrainingDateTime(toDateTimeLocal(new Date()))
    setPdfs(null)
    setBatchErrors([])
  }

  const handleLogout = async () => {
    if (!confirm('Sair da conta?')) return
    await signOut()
  }

  return (
    <div className="min-h-screen pb-32">
      <Header
        club={club}
        onChangeClub={() => setChangingClub(true)}
        user={userInfo}
        onLogout={handleLogout}
      />

      {judgeInviteMsg && (
        <div className="max-w-2xl mx-auto px-4 pt-3">
          <div className={`flex items-start justify-between gap-2 text-xs rounded-md p-3 border ${
            judgeInviteMsg.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            <span className="leading-relaxed">{judgeInviteMsg.text}</span>
            <button onClick={() => setJudgeInviteMsg(null)} className="font-bold px-1">×</button>
          </div>
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'treino' && (
        <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          <div className="card p-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Sessões" value={validSessions.length} />
              <Metric label="Disparos" value={totals.disparos} />
              <Metric label="Total" value={`R$ ${totalPagar.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} />
            </div>
          </div>

          <div className="card p-4">
            <div className="label mb-1.5">Data e hora do treino</div>
            <input
              type="datetime-local"
              className="input"
              value={trainingDateTime}
              onChange={(e) => setTrainingDateTime(e.target.value)}
            />
            <div className="text-[10px] text-stone-400 mt-1.5">
              Define quando o treino foi feito. Usado no histórico, na evolução e nos relatórios.
            </div>
          </div>

          <div>
            <button
              onClick={() => setShowTrainings(!showTrainings)}
              className="w-full px-4 py-3 text-xs font-semibold tracking-wide uppercase text-stone-500 hover:text-navy flex items-center justify-between"
            >
              <span>{showTrainings ? '- treinos salvos' : '+ treinos salvos'}</span>
              <span className="text-stone-400 normal-case font-normal lowercase tracking-normal">
                {trainings.length} {trainings.length === 1 ? 'salvo' : 'salvos'}
              </span>
            </button>
            {showTrainings && (
              <div className="card divide-y divide-stone-100">
                {trainings.length === 0 && (
                  <div className="p-4 text-center text-sm text-stone-400">nenhum treino salvo ainda</div>
                )}
                {trainings.map((t) => {
                  const tDisparos = t.sessions.reduce((acc, s) => acc + (s.disparos || 0), 0)
                  return (
                    <div key={t.id} className="p-3 flex items-center justify-between gap-2">
                      <button onClick={() => loadTrainingFromHistory(t.id)} className="flex-1 text-left hover:opacity-80 transition">
                        <div className="text-sm font-semibold">{t.label}</div>
                        <div className="text-[11px] text-stone-500">
                          {t.club?.name ? `${t.club.name}  ·  ` : ''}
                          {t.sessions.length} {t.sessions.length === 1 ? 'sessão' : 'sessões'}  ·  {tDisparos} disparos
                        </div>
                      </button>
                      <button onClick={() => deleteTrainingFromHistory(t.id)} className="btn-ghost text-red-600 px-2">×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {sessions.map((s, i) => (
              <ErrorBoundary key={s.id} label={`a sessão ${i + 1}`}>
                <SessionCard session={s} index={i} acervo={acervo}
                  onChange={(updated) => updateSession(s.id, updated)}
                  onRemove={() => removeSession(s.id)} />
              </ErrorBoundary>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={addSession} className="btn-secondary">+ nova sessão</button>
            <button onClick={newTraining} className="btn-secondary text-stone-500">limpar tela</button>
          </div>

          {(canBatchAnalyze || batchAnalyzing || batchProgress.total > 0 || batchErrors.length > 0) && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-navy">
                    Análise em lote
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    {batchAnalyzing
                      ? `Analisando ${batchProgress.current} de ${batchProgress.total}…`
                      : pendingAnalysis.length > 0
                        ? `${pendingAnalysis.length} ${pendingAnalysis.length === 1 ? 'sessão pendente' : 'sessões pendentes'}${analyzedCount > 0 ? `  ·  ${analyzedCount} já analisada${analyzedCount === 1 ? '' : 's'}` : ''}`
                        : `${analyzedCount} ${analyzedCount === 1 ? 'sessão analisada' : 'sessões analisadas'}`}
                  </div>
                </div>
                {!batchAnalyzing && canBatchAnalyze && (
                  <button onClick={analyzeAllPending}
                    className="px-3 py-2 bg-navy text-white text-xs font-semibold tracking-wide rounded-md hover:bg-navy-700 transition active:scale-[0.98] flex-shrink-0 border-b-2 border-gold">
                    analisar todas
                  </button>
                )}
                {batchAnalyzing && <Spinner size="5" />}
              </div>
              {batchAnalyzing && (
                <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gold transition-all duration-300"
                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
                </div>
              )}
              {!batchAnalyzing && batchErrors.length > 0 && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2 space-y-1">
                  <div className="font-semibold">Falhas:</div>
                  {batchErrors.map((err, i) => (
                    <div key={i}>Sessão S{err.sessionIndex}: {err.message}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {pdfs && (
            <div className="card p-4 space-y-2">
              <div className="label mb-2 text-navy">RELATÓRIOS PRONTOS · TAP PRA BAIXAR</div>
              <button onClick={() => downloadPdf(pdfs.resumo)} className="w-full px-3 py-3 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-md text-sm flex items-center justify-between transition">
                <span>Resumo executivo</span>
                <span className="text-xs text-stone-400">baixar</span>
              </button>
              <button onClick={() => downloadPdf(pdfs.completo)} className="w-full px-3 py-3 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-md text-sm flex items-center justify-between transition">
                <span>Relatório completo</span>
                <span className="text-xs text-stone-400">baixar</span>
              </button>
              <button onClick={() => downloadPdf(pdfs.cobranca)} className="w-full px-3 py-3 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-md text-sm flex items-center justify-between transition">
                <span>Cobrança (PIX)</span>
                <span className="text-xs text-stone-400">baixar</span>
              </button>
            </div>
          )}

          <div>
            <button onClick={() => setShowSettings(!showSettings)}
              className="w-full px-4 py-3 text-xs font-semibold tracking-wide uppercase text-stone-500 hover:text-navy">
              {showSettings ? '- configurações' : '+ configurações'}
            </button>
            {showSettings && (
              <SettingsPanel
                acervo={acervo}
                onAddAcervo={handleAddAcervo}
                onUpdateAcervo={handleUpdateAcervo}
                onRemoveAcervo={handleRemoveAcervo}
                precos={precos} setPrecos={setPrecos}
                settings={settings} setSettings={setSettings}
                club={club} onChangeClub={() => setChangingClub(true)}
                user={userInfo} onLogout={handleLogout}
                optedInRanking={profile?.show_in_ranking || false}
                onToggleRanking={toggleRanking}
                nickname={profile?.nickname || ''}
                onChangeNickname={changeNickname}
              />
            )}
          </div>
        </main>
      )}

      {activeTab === 'acervo' && (
        <AcervoScreen
          acervo={acervo}
          trainings={trainings}
          userId={user.id}
          onAddAcervo={handleAddAcervo}
          onUpdateAcervo={handleUpdateAcervo}
          onRemoveAcervo={handleRemoveAcervo}
        />
      )}
      {activeTab === 'challenge' && (
        <ChallengeScreen
          userId={user.id}
          acervo={acervo}
          club={club}
          userDisplayName={userInfo.displayName}
          optedInRanking={profile?.show_in_ranking || false}
          onToggleOptIn={toggleRanking}
        />
      )}
      {activeTab === 'campeonato' && (
        <ChampionshipScreen userId={user.id} acervo={acervo} club={club} />
      )}
      {activeTab === 'evolucao' && <EvolutionScreen trainings={trainings} />}
      {activeTab === 'ranking' && (
        <RankingScreen
          currentUserId={user.id}
          optedIn={profile?.show_in_ranking || false}
          onToggleOptIn={toggleRanking}
          currentClub={club}
        />
      )}

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-cream border-t border-stone-200 safe-bottom z-30">
        {activeTab === 'treino' && (
          <div className="max-w-2xl mx-auto p-4 pb-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button onClick={generateAll} disabled={!canGenerate || generating} className="btn-primary">
                {generating ? 'gerando…' : `gerar relatórios  ·  ${validSessions.length} ${validSessions.length === 1 ? 'sessão' : 'sessões'}`}
              </button>
              <button onClick={saveCurrentTraining} disabled={!hasData}
                className={`px-4 py-3.5 text-sm font-semibold tracking-wide rounded-md transition active:scale-[0.98] ${
                  saveFlash ? 'bg-green-600 text-white' : 'bg-white border border-navy text-navy hover:bg-stone-50'
                } disabled:opacity-50`}
                title="Salvar treino atual">
                {saveFlash ? 'salvo' : 'salvar'}
              </button>
            </div>
          </div>
        )}
        {/* Tab navigation */}
        <div className="max-w-2xl mx-auto px-2 pt-1 pb-1 flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); window.scrollTo(0, 0) }}
              className={`flex-1 py-3 flex flex-col items-center transition relative ${
                activeTab === tab.id ? 'text-navy' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              <span className={`text-[11px] tracking-[0.12em] uppercase ${activeTab === tab.id ? 'font-bold' : 'font-medium'}`}>{tab.label}</span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-gold" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-xl font-light text-navy">{value}</div>
      <div className="text-[10px] tracking-[0.12em] uppercase text-stone-400 mt-0.5">{label}</div>
    </div>
  )
}

function Spinner({ size = '8' }) {
  return (
    <svg className={`animate-spin h-${size} w-${size} text-gold`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
