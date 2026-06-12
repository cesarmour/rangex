import { useState, useEffect } from 'react'
import PhotoInput from './PhotoInput.jsx'
import TargetOverlay from './TargetOverlay.jsx'
import { targetList, DEFAULT_TARGET, DEFAULT_FRAME } from '../lib/targets.js'
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
// Setup obrigatorio: quantidade de tiros, foto do alvo, árbitro/RO
// (convite por WhatsApp), escopo (local/regional/nacional), arma e calibre,
// data de encerramento.
// Atirador envia SO a foto (sem analise no lado dele). O árbitro tem o fluxo
// completo de deteccao/correcao e a palavra final. Ranking = melhor submissao
// aprovada de cada atirador.

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

function toDateTimeLocal(date) {
  const d = date ? new Date(date) : new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

const SCOPE_LABELS = { local: 'Local', regional: 'Regional', nacional: 'Nacional' }
const SCOPE_HINTS = {
  local: 'Apenas atiradores do seu clube.',
  regional: 'Atiradores dos clubes listados.',
  nacional: 'Aberto a todos os clubes.',
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

      {loading ? (
        <div className="text-xs text-stone-500 py-8 text-center">carregando…</div>
      ) : champs.length === 0 && !showCreate ? (
        <div className="card p-6 text-center space-y-2">
          <div className="text-sm font-semibold text-navy">Nenhum campeonato por aqui</div>
          <div className="text-[11px] text-stone-500 leading-relaxed">
            Crie o primeiro: defina tiros, alvo, árbitro/RO, escopo, arma e calibre. As submissões só entram no ranking depois da auditoria do árbitro.
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

// ============ CRIAR (setup com etapas obrigatorias) ============

function CreateChampionship({ userId, acervo, club, onCreated }) {
  const [name, setName] = useState('')
  const [shots, setShots] = useState('')
  const [targetType, setTargetType] = useState(DEFAULT_TARGET)
  const [photo, setPhoto] = useState(null)
  const [scope, setScope] = useState('local')
  const [clubsText, setClubsText] = useState('')
  const [armaId, setArmaId] = useState('')
  const [arma, setArma] = useState('')
  const [calibre, setCalibre] = useState('')
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 7 * 24 * 3600 * 1000)))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [created, setCreated] = useState(null)

  const types = targetList()

  const pickArma = (id) => {
    setArmaId(id)
    const item = acervo.find((a) => a.id === id)
    if (item) { setArma(item.arma); setCalibre(item.calibre) }
  }

  const submit = async () => {
    setErr(null)
    if (!name.trim()) return setErr('Dê um nome ao campeonato.')
    const nShots = parseInt(shots)
    if (!nShots || nShots <= 0) return setErr('Informe a quantidade de tiros.')
    if (!photo) return setErr('Envie a foto do alvo utilizado.')
    if (scope === 'regional' && !clubsText.trim()) return setErr('Liste os clubes participantes (um por linha).')
    if (!arma.trim() || !calibre.trim()) return setErr('Escolha arma e calibre.')
    if (!endsAt || new Date(endsAt).getTime() <= Date.now()) return setErr('Data de encerramento precisa ser no futuro.')

    setSaving(true)
    try {
      const photoPath = await uploadChampionshipPhoto(userId, photo)
      const clubs = scope === 'regional'
        ? clubsText.split('\n').map((s) => s.trim()).filter(Boolean)
        : null
      const res = await createChampionship({
        name: name.trim(),
        shots: nShots,
        targetType,
        targetPhotoPath: photoPath,
        scope,
        clubs,
        arma: arma.trim(),
        calibre: calibre.trim(),
        endsAt: new Date(endsAt).toISOString(),
      })
      setCreated({ id: res.id, name: name.trim(), judgeInviteToken: res.judge_invite_token })
    } catch (e) {
      setErr(e.message || 'Erro ao criar campeonato')
    } finally {
      setSaving(false)
    }
  }

  if (created) {
    return (
      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-navy">Campeonato criado</div>
        <div className="text-[11px] text-stone-600 leading-relaxed">
          Falta a etapa obrigatória: <strong>eleger o Árbitro/RO</strong>. Mande o convite pelo WhatsApp. Quando a pessoa abrir o link e entrar (ou criar a conta), vira o árbitro do campeonato e ganha o badge.
        </div>
        <a
          href={inviteJudgeLink(created)}
          target="_blank"
          rel="noreferrer"
          className="block w-full text-center px-4 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-md hover:bg-emerald-700 transition"
        >
          convidar árbitro pelo WhatsApp
        </a>
        <button onClick={onCreated} className="w-full px-4 py-2 text-xs text-stone-500 underline">
          concluir (dá pra convidar depois pelo card)
        </button>
      </div>
    )
  }

  return (
    <div className="card p-4 space-y-4">
      <div className="text-sm font-semibold text-navy">Novo campeonato</div>

      <div>
        <div className="label mb-1.5">Nome</div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Copa do Clube 2026" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label mb-1.5">Quantidade de tiros</div>
          <input type="number" inputMode="numeric" className="input" value={shots}
            onChange={(e) => setShots(e.target.value)} placeholder="12" />
        </div>
        <div>
          <div className="label mb-1.5">Encerramento</div>
          <input type="datetime-local" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="label mb-1.5">Tipo de alvo</div>
        <select className="input" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
          {types.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
        </select>
      </div>

      <div>
        <div className="label mb-1.5">Foto do alvo utilizado</div>
        <PhotoInput value={photo} onChange={setPhoto} />
      </div>

      <div>
        <div className="label mb-1.5">Escopo</div>
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
        <div className="text-[11px] text-stone-500 mt-1.5">
          {SCOPE_HINTS[scope]}{scope === 'local' && club?.name ? ` Clube: ${club.name}.` : ''}
        </div>
        {scope === 'regional' && (
          <textarea className="input mt-2 min-h-[70px]" value={clubsText}
            onChange={(e) => setClubsText(e.target.value)}
            placeholder={'Clubes participantes, um por linha\n(igual aparece no perfil dos atiradores)'} />
        )}
      </div>

      <div>
        <div className="label mb-1.5">Arma e calibre</div>
        <select className="input mb-2" value={armaId} onChange={(e) => pickArma(e.target.value)}>
          <option value="">Pegar do meu acervo…</option>
          {acervo.map((a) => (<option key={a.id} value={a.id}>{a.arma}  ·  {a.calibre}</option>))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input className="input" value={arma} onChange={(e) => setArma(e.target.value)} placeholder="Arma" />
          <input className="input" value={calibre} onChange={(e) => setCalibre(e.target.value)} placeholder="Calibre" />
        </div>
      </div>

      <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed">
        Em campeonato o atirador <strong>não tem análise automática</strong>: ele só envia a foto do alvo. Quem detecta, corrige e pontua é o <strong>Árbitro/RO</strong>, e só submissão aprovada entra no ranking. Vale a melhor aprovada de cada atirador até o encerramento.
      </div>

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}

      <button onClick={submit} disabled={saving}
        className="w-full px-4 py-3 bg-navy text-white text-sm font-semibold rounded-md border-b-2 border-gold disabled:opacity-50 transition">
        {saving ? 'criando…' : 'criar campeonato'}
      </button>
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
              {champ.arma}  ·  {champ.calibre}  ·  {champ.shots} tiros  ·  até {fmtDate(champ.endsAt)}
            </div>
            <div className="text-[11px] text-stone-500 flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span>org: {champ.organizerName || '—'}</span>
              <span>·</span>
              {champ.judgeId ? (
                <span className="flex items-center gap-1">árbitro: {champ.judgeName} <JudgeBadge /></span>
              ) : (
                <span className="text-amber-700">sem árbitro eleito</span>
              )}
              {(champ.iAmJudge || champ.iAmOrganizer) && champ.pendingCount > 0 && (
                <span className="text-amber-700 font-semibold">· {champ.pendingCount} pendente{champ.pendingCount > 1 ? 's' : ''}</span>
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
  const [refUrl, setRefUrl] = useState(null)
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
      const [s, r, url] = await Promise.all([
        listChampionshipSubmissions(champ.id),
        championshipRanking(champ.id),
        getChampionshipPhotoUrl(champ.targetPhotoPath),
      ])
      setSubs(s)
      setRanking(r)
      setRefUrl(url)
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
  const canShoot = open && !champ.iAmJudge

  if (loading) return <div className="p-4 text-xs text-stone-500">carregando…</div>

  return (
    <div className="p-4 pt-0 space-y-4">
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}

      {refUrl && (
        <div>
          <div className="label mb-1.5">Alvo do campeonato</div>
          <img src={refUrl} alt="Alvo do campeonato" className="w-full rounded-md border border-stone-200 object-contain max-h-72 bg-stone-50" />
        </div>
      )}

      {champ.iAmOrganizer && (
        <div className="flex flex-wrap gap-2">
          {!champ.judgeId && champ.judgeInviteToken && (
            <a href={inviteJudgeLink(champ)} target="_blank" rel="noreferrer"
              className="px-3 py-2 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition">
              convidar árbitro pelo WhatsApp
            </a>
          )}
          {champ.status === 'open' && (
            <button onClick={handleClose}
              className="px-3 py-2 text-xs font-semibold rounded-md bg-stone-100 text-red-600 hover:bg-red-50 transition">
              encerrar campeonato
            </button>
          )}
        </div>
      )}

      {/* Ranking */}
      <div>
        <div className="label mb-1.5">Ranking (auditado)</div>
        {ranking.length === 0 ? (
          <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-md p-2.5">
            Ainda sem submissões aprovadas pelo árbitro.
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
            Envie só a foto do alvo ({champ.shots} tiros, {champ.arma} · {champ.calibre}). Sem análise automática aqui: quem pontua é o Árbitro/RO. Pode reenviar até o encerramento; vale a melhor aprovada.
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
              Nenhuma submissão pendente.
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
              Atenção: o campeonato é de <strong>{champ.shots} tiros</strong> e essa marcação tem <strong>{disparos}</strong>.
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
