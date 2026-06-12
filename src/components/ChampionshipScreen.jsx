import { useState, useEffect } from 'react'
import PhotoInput from './PhotoInput.jsx'
import TargetOverlay from './TargetOverlay.jsx'
import { targetList, getTarget, DEFAULT_TARGET, DEFAULT_FRAME } from '../lib/targets.js'
import { detectAndScore, scoreWithFrame } from '../lib/analyze.js'
import {
  createChampionship,
  listChampionships,
  submitChampionshipEntry,
  listChampionshipSubmissions,
  judgeReviewSubmission,
  championshipRanking,
  closeChampionship,
  uploadChampionshipPhoto,
  getChampionshipPhotoUrl,
} from '../lib/db.js'

// Aba Campeonato.
// Criacao em assistente de etapas (prova, alvo, visibilidade, arma, árbitro).
// Atirador envia SO a foto (sem analise no lado dele). O Árbitro/RO tem o
// fluxo completo de deteccao/correcao e a palavra final. Ranking = melhor
// submissao aprovada de cada atirador ate o encerramento.

const QKEYS = ['amarelo', 'verde', 'vermelho', 'azul']

function gatherHoles(scoring) {
  const holes = []
  for (const q of QKEYS) {
    const qd = scoring?.quadrantes?.[q]
    if (!qd?.hits) continue
    for (const h of qd.hits) holes.push({ x: h.x, y: h.y, confidence: h.confidence })
  }
  return holes
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Não consegui baixar a foto')
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (e) => resolve(e.target.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtDay(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function toDateInput(date) {
  const d = date ? new Date(date) : new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

const SCOPE_LABELS = { local: 'Local', regional: 'Regional', nacional: 'Nacional' }

function visibleTo(champ) {
  if (champ.scope === 'nacional') return 'todos os clubes'
  if (champ.clubs && champ.clubs.length) return champ.clubs.join(', ')
  return '—'
}

export function JudgeBadge() {
  return (
    <span className="text-[9px] tracking-[0.1em] uppercase text-gold font-semibold bg-gold/10 border border-gold/30 px-1.5 py-0.5 rounded">
      Árbitro/RO
    </span>
  )
}

function inviteJudgeLink(champ) {
  const link = `https://strikecore.pro/?juiz=${champ.judgeInviteToken}`
  const msg = `Você foi eleito Árbitro/RO do campeonato "${champ.name}" no STRIKECORE. ` +
    `Toque no link, entre (ou crie sua conta) e o convite é aceito automaticamente: ${link}`
  return `https://wa.me/?text=${encodeURIComponent(msg)}`
}

export default function ChampionshipScreen({ userId, acervo, club }) {
  const [champs, setChamps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  const reload = async () => {
    try {
      setError(null)
      const list = await listChampionships()
      setChamps(list)
    } catch (e) {
      setError(e.message || 'Erro ao carregar campeonatos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-navy">Campeonatos</div>
          <div className="text-[11px] text-stone-500">Submissões auditadas por Árbitro/RO</div>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className={`px-3 py-2 text-xs font-semibold rounded-md transition ${
            showCreate ? 'bg-stone-100 text-stone-600' : 'bg-navy text-white border-b-2 border-gold'
          }`}
        >
          {showCreate ? 'cancelar' : 'criar campeonato'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2.5">{error}</div>
      )}

      {showCreate && (
        <CreateChampionship
          userId={userId}
          acervo={acervo}
          club={club}
          onCreated={() => { setShowCreate(false); reload() }}
        />
      )}

      {!showCreate && (
        <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-3 leading-relaxed">
          <strong>Como funciona:</strong> o organizador cria a prova e convida o Árbitro/RO pelo WhatsApp. Os atiradores dos clubes do escopo veem o campeonato aqui e enviam só a foto do alvo. O árbitro audita cada submissão e só as aprovadas entram no ranking, conforme a regra da prova: melhor aprovada até o encerramento ou submissão única.
        </div>
      )}

      {loading ? (
        <div className="text-xs text-stone-500 py-8 text-center">carregando…</div>
      ) : champs.length === 0 && !showCreate ? (
        <div className="card p-6 text-center space-y-2">
          <div className="text-sm font-semibold text-navy">Nenhum campeonato visível pra você</div>
          <div className="text-[11px] text-stone-500 leading-relaxed">
            Aqui aparecem os campeonatos do seu clube ({club?.name || 'defina seu clube'}), os regionais que incluem seu clube, os nacionais, e os que você organiza ou arbitra. Toque em "criar campeonato" pra montar o primeiro.
          </div>
        </div>
      ) : (
        champs.map((c) => (
          <ChampionshipCard
            key={c.id}
            champ={c}
            userId={userId}
            expanded={expandedId === c.id}
            onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
            onChanged={reload}
          />
        ))
      )}
    </main>
  )
}

// ============ CRIAR: assistente em etapas ============

const STEPS = ['Prova', 'Alvo', 'Visibilidade', 'Arma', 'Árbitro']

function CreateChampionship({ userId, acervo, club, onCreated }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [shots, setShots] = useState('')
  const [targetType, setTargetType] = useState(DEFAULT_TARGET)
  const [scope, setScope] = useState('local')
  const [clubsText, setClubsText] = useState('')
  const [armaId, setArmaId] = useState('')
  const [arma, setArma] = useState('')
  const [calibre, setCalibre] = useState('')
  const [submissionMode, setSubmissionMode] = useState('best')
  const [endsAt, setEndsAt] = useState(() => toDateInput(new Date(Date.now() + 7 * 24 * 3600 * 1000)))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [created, setCreated] = useState(null)

  const types = targetList()

  const pickArma = (id) => {
    setArmaId(id)
    const item = acervo.find((a) => a.id === id)
    if (item) { setArma(item.arma); setCalibre(item.calibre) }
  }

  // Validacao da etapa atual. Retorna a mensagem de erro ou null.
  const validateStep = (i) => {
    if (i === 0) {
      if (!name.trim()) return 'Dê um nome ao campeonato.'
      const n = parseInt(shots)
      if (!n || n <= 0) return 'Informe a quantidade de tiros.'
      if (!endsAt || new Date(`${endsAt}T23:59:59`).getTime() <= Date.now()) return 'Data de encerramento precisa ser no futuro.'
      return null
    }
    if (i === 1) {
      return null // o alvo e um modelo do app, sem upload
    }
    if (i === 2) {
      if (scope === 'local' && !club?.name) return 'Selecione seu clube antes (cabeçalho > trocar clube).'
      if (scope === 'regional' && !clubsText.trim()) return 'Liste os clubes participantes (um por linha).'
      return null
    }
    if (i === 3) {
      if (!arma.trim() || !calibre.trim()) return 'Escolha arma e calibre.'
      return null
    }
    return null
  }

  const next = () => {
    const v = validateStep(step)
    if (v) { setErr(v); return }
    setErr(null)
    setStep(step + 1)
  }
  const back = () => { setErr(null); setStep(Math.max(0, step - 1)) }

  const submit = async () => {
    for (let i = 0; i < 4; i++) {
      const v = validateStep(i)
      if (v) { setErr(v); setStep(i); return }
    }
    setErr(null)
    setSaving(true)
    try {
      const clubs = scope === 'regional'
        ? clubsText.split('\n').map((s) => s.trim()).filter(Boolean)
        : null
      const endIso = new Date(`${endsAt}T23:59:59`)
      const res = await createChampionship({
        name: name.trim(),
        shots: parseInt(shots),
        targetType,
        targetPhotoPath: null, // o alvo e um modelo do app (targets.js), sem upload
        scope,
        clubs,
        arma: arma.trim(),
        calibre: calibre.trim(),
        endsAt: endIso.toISOString(),
        submissionMode,
      })
      setCreated({ id: res.id, name: name.trim(), judgeInviteToken: res.judge_invite_token })
    } catch (e) {
      setErr(e.message || 'Erro ao criar campeonato')
    } finally {
      setSaving(false)
    }
  }

  // Pos-criacao: a etapa que falta e o convite do árbitro.
  if (created) {
    return (
      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-navy">"{created.name}" criado</div>
        <div className="text-[11px] text-stone-600 leading-relaxed space-y-1.5">
          <div><strong>1.</strong> Convide o Árbitro/RO pelo WhatsApp (botão abaixo). Quando ele abrir o link e entrar, vira o árbitro da prova e ganha o badge.</div>
          <div><strong>2.</strong> Os atiradores do escopo já veem o campeonato na aba e podem enviar a foto do alvo.</div>
          <div><strong>3.</strong> O árbitro audita cada submissão; só aprovada entra no ranking.</div>
        </div>
        <a
          href={inviteJudgeLink(created)}
          target="_blank"
          rel="noreferrer"
          className="block w-full text-center px-4 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-md hover:bg-emerald-700 transition"
        >
          convidar Árbitro/RO pelo WhatsApp
        </a>
        <button onClick={onCreated} className="w-full px-4 py-2 text-xs text-stone-500 underline">
          concluir (dá pra convidar depois pelo card do campeonato)
        </button>
      </div>
    )
  }

  return (
    <div className="card p-4 space-y-4">
      {/* Trilha de etapas */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <button key={s} type="button"
            onClick={() => { if (i < step) { setErr(null); setStep(i) } }}
            className={`flex-1 min-w-0 text-center ${i <= step ? '' : 'opacity-50'}`}>
            <div className={`mx-auto w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
              i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-navy text-white' : 'bg-stone-200 text-stone-500'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            <div className={`text-[8px] uppercase tracking-wide mt-0.5 truncate ${i === step ? 'font-bold text-navy' : 'text-stone-400'}`}>{s}</div>
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-navy">Etapa 1 · A prova</div>
          <div>
            <div className="label mb-1.5">Nome</div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Copa do Clube 2026" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className="label mb-1.5">Quantidade de tiros</div>
              <input type="number" inputMode="numeric" className="input" value={shots}
                onChange={(e) => setShots(e.target.value)} placeholder="12" />
            </div>
            <div className="min-w-0">
              <div className="label mb-1.5">Encerramento</div>
              <input type="date" className="input w-full min-w-0" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div>
            <div className="label mb-1.5">Submissões</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSubmissionMode('best')}
                className={`px-2 py-2 text-xs font-semibold rounded-md border transition ${
                  submissionMode === 'best' ? 'bg-navy text-white border-navy' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
                }`}>
                melhor aprovada
              </button>
              <button type="button" onClick={() => setSubmissionMode('single')}
                className={`px-2 py-2 text-xs font-semibold rounded-md border transition ${
                  submissionMode === 'single' ? 'bg-navy text-white border-navy' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
                }`}>
                submissão única
              </button>
            </div>
            <div className="text-[11px] text-stone-500 mt-1.5">
              {submissionMode === 'best'
                ? 'O atirador pode reenviar até o encerramento; vale a melhor aprovada pelo árbitro.'
                : 'Cada atirador envia uma única submissão. Só pode reenviar se o árbitro rejeitar.'}
            </div>
          </div>
          <div className="text-[11px] text-stone-500">Submissões valem até as 23:59 do dia escolhido. Você pode encerrar antes.</div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-navy">Etapa 2 · O alvo utilizado</div>
          <div>
            <div className="label mb-1.5">Tipo de alvo</div>
            <select className="input" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
              {types.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
            </select>
          </div>
          <div>
            <div className="label mb-1.5">Modelo</div>
            <img
              src={getTarget(targetType).image}
              alt={types.find((t) => t.id === targetType)?.label}
              className="w-full rounded-md border border-stone-200 object-contain max-h-72 bg-white"
            />
            <div className="text-[11px] text-stone-500 mt-1.5">Esse modelo fica no card da prova pra todo atirador saber qual alvo usar.</div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-navy">Etapa 3 · Quem vê e participa</div>
          <div className="grid grid-cols-3 gap-2">
            {['local', 'regional', 'nacional'].map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)}
                className={`px-2 py-2 text-xs font-semibold rounded-md border transition ${
                  scope === s ? 'bg-navy text-white border-navy' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
                }`}>
                {SCOPE_LABELS[s]}
              </button>
            ))}
          </div>
          {scope === 'regional' && (
            <textarea className="input min-h-[70px]" value={clubsText}
              onChange={(e) => setClubsText(e.target.value)}
              placeholder={'Clubes participantes, um por linha\n(o nome tem que bater com o clube do perfil dos atiradores)'} />
          )}
          <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed">
            {scope === 'local' && (<span>Visível só pra atiradores do clube <strong>{club?.name || '—'}</strong> (o clube selecionado no perfil de cada um).</span>)}
            {scope === 'regional' && (<span>Visível pra atiradores cujo clube do perfil está na lista acima.</span>)}
            {scope === 'nacional' && (<span>Visível pra todos os atiradores do STRIKECORE, de qualquer clube.</span>)}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-navy">Etapa 4 · Arma e calibre da prova</div>
          <select className="input" value={armaId} onChange={(e) => pickArma(e.target.value)}>
            <option value="">Pegar do meu acervo…</option>
            {acervo.map((a) => (<option key={a.id} value={a.id}>{a.arma}  ·  {a.calibre}</option>))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input className="input min-w-0" value={arma} onChange={(e) => setArma(e.target.value)} placeholder="Arma" />
            <input className="input min-w-0" value={calibre} onChange={(e) => setCalibre(e.target.value)} placeholder="Calibre" />
          </div>
          <div className="text-[11px] text-stone-500">Fica exibido no card como exigência da prova.</div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-navy">Etapa 5 · Árbitro/RO e revisão</div>
          <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed">
            O <strong>Árbitro/RO</strong> é quem audita as submissões: ele recebe um convite por <strong>WhatsApp</strong> logo depois que você criar a prova. Sem aprovação dele, nenhuma pontuação entra no ranking. Em campeonato o atirador não tem análise automática: envia só a foto.
          </div>
          <div className="text-[11px] text-stone-700 bg-white border border-stone-200 rounded-md p-2.5 leading-relaxed space-y-0.5">
            <div><span className="text-stone-400">nome:</span> <strong>{name || '—'}</strong></div>
            <div><span className="text-stone-400">tiros:</span> {shots || '—'} · <span className="text-stone-400">alvo:</span> {types.find((t) => t.id === targetType)?.label}</div>
            <div><span className="text-stone-400">escopo:</span> {SCOPE_LABELS[scope]} ({scope === 'local' ? (club?.name || '—') : scope === 'regional' ? (clubsText.split('\n').map(s => s.trim()).filter(Boolean).join(', ') || '—') : 'todos os clubes'})</div>
            <div><span className="text-stone-400">arma:</span> {arma || '—'} · {calibre || '—'}</div>
            <div><span className="text-stone-400">submissões:</span> {submissionMode === 'best' ? 'melhor aprovada até o fim' : 'única (reenvio só se rejeitada)'}</div>
            <div><span className="text-stone-400">encerra:</span> {endsAt ? new Date(`${endsAt}T23:59:59`).toLocaleDateString('pt-BR') : '—'} às 23:59</div>
          </div>
        </div>
      )}

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={back} disabled={step === 0}
          className="px-3 py-2.5 text-xs font-semibold rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 disabled:opacity-40 transition">
          voltar
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={next}
            className="px-3 py-2.5 text-xs font-semibold rounded-md bg-navy text-white border-b-2 border-gold transition">
            avançar
          </button>
        ) : (
          <button onClick={submit} disabled={saving}
            className="px-3 py-2.5 text-xs font-semibold rounded-md bg-navy text-white border-b-2 border-gold disabled:opacity-50 transition">
            {saving ? 'criando…' : 'criar campeonato'}
          </button>
        )}
      </div>
    </div>
  )
}

// ============ CARD ============

function ChampionshipCard({ champ, userId, expanded, onToggle, onChanged }) {
  const open = champ.status === 'open' && new Date(champ.endsAt).getTime() > Date.now()
  return (
    <div className="card">
      <button onClick={onToggle} className="w-full text-left">
        <div className="card-header">
          <div className="min-w-0">
            <div className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
              <span className="truncate">{champ.name}</span>
              <span className="text-[9px] tracking-[0.1em] uppercase font-semibold bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">
                {SCOPE_LABELS[champ.scope] || champ.scope}
              </span>
              <span className={`text-[9px] tracking-[0.1em] uppercase font-semibold px-1.5 py-0.5 rounded ${
                open ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'
              }`}>
                {open ? 'aberto' : 'encerrado'}
              </span>
            </div>
            <div className="text-[11px] text-stone-500 mt-0.5">
              {champ.arma}  ·  {champ.calibre}  ·  {champ.shots} tiros  ·  {champ.submissionMode === 'single' ? 'submissão única' : 'melhor aprovada'}  ·  até {fmtDay(champ.endsAt)}
            </div>
            <div className="text-[11px] text-stone-500 mt-0.5">visível para: {visibleTo(champ)}</div>
            <div className="text-[11px] text-stone-500 flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span>org: {champ.organizerName || '—'}</span>
              <span>·</span>
              {champ.judgeId ? (
                <span className="flex items-center gap-1">árbitro: {champ.judgeName} <JudgeBadge /></span>
              ) : (
                <span className="text-amber-700 font-semibold">aguardando árbitro aceitar convite</span>
              )}
              {(champ.iAmJudge || champ.iAmOrganizer) && champ.pendingCount > 0 && (
                <span className="text-amber-700 font-semibold">· {champ.pendingCount} pra auditar</span>
              )}
            </div>
          </div>
          <div className="text-stone-400 text-sm pl-2">{expanded ? '-' : '+'}</div>
        </div>
      </button>
      {expanded && (
        <ChampionshipDetail champ={champ} userId={userId} open={open} onChanged={onChanged} />
      )}
    </div>
  )
}

// ============ DETALHE ============

function ChampionshipDetail({ champ, userId, open, onChanged }) {
  const [subs, setSubs] = useState([])
  const [ranking, setRanking] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [sending, setSending] = useState(false)
  const [reviewingId, setReviewingId] = useState(null)

  const reload = async () => {
    try {
      setErr(null)
      const [s, r] = await Promise.all([
        listChampionshipSubmissions(champ.id),
        championshipRanking(champ.id),
      ])
      setSubs(s)
      setRanking(r)
    } catch (e) {
      setErr(e.message || 'Erro ao carregar campeonato')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [champ.id])

  const sendSubmission = async () => {
    if (!photo) return
    setSending(true)
    setErr(null)
    try {
      const path = await uploadChampionshipPhoto(userId, photo)
      await submitChampionshipEntry(champ.id, path)
      setPhoto(null)
      await reload()
      onChanged()
    } catch (e) {
      setErr(e.message || 'Erro ao enviar')
    } finally {
      setSending(false)
    }
  }

  const handleClose = async () => {
    if (!confirm('Encerrar o campeonato? Submissões e auditorias param de valer a partir daqui.')) return
    try {
      await closeChampionship(champ.id)
      onChanged()
    } catch (e) {
      setErr(e.message || 'Erro ao encerrar')
    }
  }

  const mySubs = subs.filter((s) => s.shooterId === userId)
  const pending = subs.filter((s) => s.status === 'pending')
  // Submissao unica: ja enviou (pendente ou aprovada) = nao reenvia
  const singleUsed = champ.submissionMode === 'single'
    && mySubs.some((s) => s.status === 'pending' || s.status === 'approved')
  const canShoot = open && !champ.iAmJudge && !singleUsed

  if (loading) return <div className="p-4 text-xs text-stone-500">carregando…</div>

  return (
    <div className="p-4 pt-0 space-y-4">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}

      {/* Organizador sem árbitro: o proximo passo e o convite */}
      {champ.iAmOrganizer && !champ.judgeId && champ.judgeInviteToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-2">
          <div className="text-[11px] text-amber-800 leading-relaxed">
            <strong>Falta o Árbitro/RO.</strong> Sem ele ninguém audita e nenhuma pontuação entra no ranking. Mande o convite:
          </div>
          <a href={inviteJudgeLink(champ)} target="_blank" rel="noreferrer"
            className="block w-full text-center px-3 py-2.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition">
            convidar Árbitro/RO pelo WhatsApp
          </a>
        </div>
      )}

      <div>
        <div className="label mb-1.5">Alvo da prova · {getTarget(champ.targetType).label}</div>
        <img src={getTarget(champ.targetType).image} alt="Alvo da prova"
          className="w-full rounded-md border border-stone-200 object-contain max-h-72 bg-white" />
      </div>

      {/* Ranking */}
      <div>
        <div className="label mb-1.5">Ranking (auditado pelo Árbitro/RO)</div>
        {ranking.length === 0 ? (
          <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-md p-2.5">
            Ainda sem submissões aprovadas.
          </div>
        ) : (
          <div className="space-y-1">
            {ranking.map((r, i) => (
              <div key={r.shooterId}
                className={`flex items-center justify-between px-3 py-2 rounded-md text-xs ${
                  r.shooterId === userId ? 'bg-gold/10 border border-gold/30' : 'bg-stone-50 border border-stone-100'
                }`}>
                <span className="font-semibold text-stone-700">
                  {i + 1}º  {r.shooterName}{r.shooterId === userId ? ' (você)' : ''}
                </span>
                <span className="text-stone-600">{r.bestPontos} pts · {r.approvedCount} aprovada{r.approvedCount > 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submissao do atirador: SO a foto, sem analise */}
      {canShoot && (
        <div>
          <div className="label mb-1.5">Enviar submissão</div>
          <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed mb-2">
            <strong>1.</strong> Atire a prova ({champ.shots} tiros, {champ.arma} · {champ.calibre}). <strong>2.</strong> Fotografe o alvo e envie aqui (sem análise automática). <strong>3.</strong> O Árbitro/RO audita e, se aprovar, sua pontuação entra no ranking. {champ.submissionMode === 'single'
              ? 'Submissão única: só dá pra reenviar se o árbitro rejeitar.'
              : `Pode reenviar até ${fmtDay(champ.endsAt)}; vale a melhor aprovada.`}
          </div>
          <PhotoInput value={photo} onChange={setPhoto} />
          {photo && (
            <button onClick={sendSubmission} disabled={sending}
              className="w-full mt-2 px-4 py-3 bg-navy text-white text-sm font-semibold rounded-md border-b-2 border-gold disabled:opacity-50 transition">
              {sending ? 'enviando…' : 'enviar pra auditoria'}
            </button>
          )}
        </div>
      )}

      {/* Minhas submissoes */}
      {singleUsed && open && (
        <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed">
          Submissão única enviada. {mySubs.some((s) => s.status === 'approved')
            ? 'Aprovada pelo árbitro: está no ranking.'
            : 'Aguardando auditoria do Árbitro/RO. Se for rejeitada, você pode reenviar.'}
        </div>
      )}
      {mySubs.length > 0 && (
        <div>
          <div className="label mb-1.5">Minhas submissões</div>
          <div className="space-y-1">
            {mySubs.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-md text-xs bg-stone-50 border border-stone-100">
                <span className="text-stone-600">{fmtDate(s.createdAt)}</span>
                <SubmissionStatus sub={s} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auditoria do árbitro */}
      {champ.iAmJudge && (
        <div>
          <div className="label mb-1.5 flex items-center gap-1.5">Auditoria <JudgeBadge /></div>
          {!open && (
            <div className="text-[11px] text-stone-500 mb-2">Campeonato encerrado: auditoria travada.</div>
          )}
          {pending.length === 0 ? (
            <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-md p-2.5">
              Nenhuma submissão pendente. Quando um atirador enviar a foto, ela aparece aqui pra você detectar os furos, corrigir e aprovar ou rejeitar.
            </div>
          ) : (
            <div className="space-y-2">
              {pending.map((s) => (
                <div key={s.id} className="border border-stone-200 rounded-md">
                  <button
                    onClick={() => setReviewingId(reviewingId === s.id ? null : s.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <span className="font-semibold text-stone-700">{s.shooterName} · {fmtDate(s.createdAt)}</span>
                    <span className="text-navy underline">{reviewingId === s.id ? 'fechar' : 'auditar'}</span>
                  </button>
                  {reviewingId === s.id && open && (
                    <JudgeReview
                      champ={champ}
                      sub={s}
                      onDone={async () => { setReviewingId(null); await reload(); onChanged() }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {champ.iAmOrganizer && champ.status === 'open' && (
        <button onClick={handleClose}
          className="px-3 py-2 text-xs font-semibold rounded-md bg-stone-100 text-red-600 hover:bg-red-50 transition">
          encerrar campeonato
        </button>
      )}
    </div>
  )
}

function SubmissionStatus({ sub }) {
  if (sub.status === 'approved') {
    return <span className="font-semibold text-emerald-700">aprovada · {sub.pontos} pts</span>
  }
  if (sub.status === 'rejected') {
    return (
      <span className="font-semibold text-red-600">
        rejeitada{sub.judgeNote ? ` · ${sub.judgeNote}` : ''}
      </span>
    )
  }
  return <span className="font-semibold text-amber-700">aguardando auditoria</span>
}

// ============ FLUXO DE CORRECAO DO ARBITRO ============

function JudgeReview({ champ, sub, onDone }) {
  const [photo, setPhotoData] = useState(null)
  const [scoring, setScoring] = useState(sub.scoring || null)
  const [frame, setFrame] = useState(sub.frame || null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(sub.judgeNote || '')
  const [err, setErr] = useState(null)

  const targetType = champ.targetType || DEFAULT_TARGET

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const url = await getChampionshipPhotoUrl(sub.photoPath)
        if (!url) throw new Error('Foto indisponível')
        const dataUrl = await fetchAsDataUrl(url)
        if (cancelled) return
        setPhotoData(dataUrl)
        if (!sub.scoring) {
          // estrutura vazia valida pro overlay (árbitro pode marcar na mao direto)
          setScoring(scoreWithFrame([], { frame: DEFAULT_FRAME, targetType }))
          setFrame(DEFAULT_FRAME)
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Erro ao abrir a foto')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [sub.id])

  const detect = async () => {
    if (!photo) return
    setDetecting(true)
    setErr(null)
    try {
      const res = await detectAndScore({ photo, frame: frame || null, targetType })
      setScoring(res.scoring)
      setFrame(res.frame)
    } catch (e) {
      setErr(e.message || 'Erro ao detectar')
    } finally {
      setDetecting(false)
    }
  }

  const handleFrameChange = (newFrame) => {
    const holes = gatherHoles(scoring)
    const newScoring = scoreWithFrame(holes, {
      frame: newFrame,
      targetType,
      imageAspect: scoring?.image_aspect,
    })
    setFrame(newFrame)
    setScoring(newScoring)
  }

  const review = async (status) => {
    setSaving(true)
    setErr(null)
    try {
      await judgeReviewSubmission({
        submissionId: sub.id,
        status,
        pontos: status === 'approved' ? (scoring?.total_pontos || 0) : null,
        disparos: status === 'approved' ? (scoring?.total_disparos || 0) : null,
        scoring: status === 'approved' ? scoring : null,
        frame: status === 'approved' ? frame : null,
        note: note.trim() || null,
      })
      onDone()
    } catch (e) {
      setErr(e.message || 'Erro ao salvar auditoria')
      setSaving(false)
    }
  }

  if (loading) return <div className="p-3 text-xs text-stone-500">abrindo foto…</div>

  const disparos = scoring?.total_disparos || 0
  const shotsMismatch = disparos > 0 && disparos !== champ.shots

  return (
    <div className="p-3 pt-0 space-y-3 border-t border-stone-100">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}

      {photo && scoring && (
        <>
          <button onClick={detect} disabled={detecting}
            className="w-full px-3 py-2.5 text-xs font-semibold rounded-md bg-stone-100 text-stone-700 hover:bg-stone-200 disabled:opacity-50 transition">
            {detecting ? 'detectando…' : 'detectar furos no quadro'}
          </button>
          <TargetOverlay
            photo={photo}
            scoring={scoring}
            editable
            onScoringChange={setScoring}
            frame={frame}
            targetType={targetType}
            frameEditable
            onFrameChange={handleFrameChange}
          />
          {shotsMismatch && (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">
              Atenção: a prova é de <strong>{champ.shots} tiros</strong> e essa marcação tem <strong>{disparos}</strong>.
            </div>
          )}
        </>
      )}

      <div>
        <div className="label mb-1.5">Nota do árbitro (opcional)</div>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="ex: 2 furos sobrepostos no anel 5, contados" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => review('rejected')} disabled={saving}
          className="px-3 py-2.5 text-xs font-semibold rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition">
          rejeitar
        </button>
        <button onClick={() => review('approved')} disabled={saving || !scoring || disparos === 0}
          className="px-3 py-2.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition">
          {saving ? 'salvando…' : `aprovar · ${scoring?.total_pontos || 0} pts`}
        </button>
      </div>
    </div>
  )
}
