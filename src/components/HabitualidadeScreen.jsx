import { useState, useEffect, useMemo, useRef } from 'react'
import { classificarClubGun, GRUPO_LABELS, progressoHabitualidade } from '../lib/habitualidade.js'
import { buildAnexoE } from '../lib/pdf/anexoE.js'
import {
  getHabitConfig,
  listClubGuns,
  registerHabitSession,
  listMyHabitSessions,
  uploadHabitSelfie,
  habitSfpcExport,
} from '../lib/db.js'

// Habitualidade (Portaria 260-COLOG/2025).
// 1a vez: cadastro de CR e CPF (fica no perfil, nao pede de novo).
// A cada sessao: autenticacao do atirador + selfie georreferenciada + log
// imutavel (Livro/Sistema, No Registro, Data do Lancamento). Sem assinatura
// do responsavel por sessao: ela so entra no Anexo E (sob demanda) e no
// pacote mensal do SFPC (admin).

function fmtDH(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function fmtD(iso) {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
}
function toDateInput(date) {
  const d = date ? new Date(date) : new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

function DateField({ value, onChange }) {
  return (
    <div className="relative">
      <div className="input flex items-center justify-between gap-1 overflow-hidden whitespace-nowrap">
        <span>{value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : 'escolher…'}</span>
        <span className="text-stone-400 text-xs shrink-0">▾</span>
      </div>
      <input type="date" value={value} onChange={onChange}
        className="absolute inset-0 w-full h-full opacity-0"
        style={{ WebkitAppearance: 'none', appearance: 'none' }} />
    </div>
  )
}

async function compressDataUrl(dataUrl, maxDim = 900, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

export default function HabitualidadeScreen({ userId, profile, onSaveProfile, isAdmin }) {
  const [config, setConfig] = useState(null)
  const [guns, setGuns] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showLaunch, setShowLaunch] = useState(false)

  const cadastroOk = Boolean(profile?.cpf?.trim() && profile?.cr_numero?.trim())

  const reload = async () => {
    try {
      setError(null)
      const [cfg, g, s] = await Promise.all([getHabitConfig(), listClubGuns(), listMyHabitSessions()])
      setConfig(cfg)
      setGuns(g)
      setSessions(s)
    } catch (e) {
      setError(e.message || 'Erro ao carregar habitualidade')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const progresso = useMemo(
    () => progressoHabitualidade(sessions, profile?.nivel_habitualidade || '1'),
    [sessions, profile]
  )

  if (loading) return <main className="max-w-2xl mx-auto px-4 py-8 text-center text-xs text-stone-500">carregando…</main>

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-navy">Habitualidade</div>
          <div className="text-[11px] text-stone-500">Registro eletrônico · Portaria 260-COLOG/2025</div>
        </div>
        {cadastroOk && (
          <button onClick={() => setShowLaunch(!showLaunch)}
            className={`px-3 py-2 text-xs font-semibold rounded-md transition ${
              showLaunch ? 'bg-stone-100 text-stone-600' : 'bg-navy text-white border-b-2 border-gold'
            }`}>
            {showLaunch ? 'cancelar' : 'lançar sessão'}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2.5">{error}</div>}

      {!cadastroOk ? (
        <CadastroCR profile={profile} onSave={onSaveProfile} />
      ) : (
        <>
          {showLaunch && (
            <LaunchForm
              userId={userId}
              guns={guns}
              config={config}
              onDone={async () => { setShowLaunch(false); await reload() }}
            />
          )}

          {/* Progresso por grupo (12 meses, eventos deduplicados) */}
          {progresso.length > 0 && (
            <div className="card p-4 space-y-2">
              <div className="text-xs tracking-[0.18em] uppercase text-gold font-semibold">
                Progresso · nível {profile?.nivel_habitualidade === 'alto_rendimento' ? 'AR' : profile?.nivel_habitualidade} · últimos 12 meses
              </div>
              {progresso.map((p) => (
                <div key={p.grupo} className="flex items-center justify-between text-xs bg-stone-50 border border-stone-100 rounded-md px-3 py-2">
                  <span className="text-stone-700 font-semibold">{GRUPO_LABELS[p.grupo]}</span>
                  <span className={p.atingido ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                    {String(profile?.nivel_habitualidade) === '1'
                      ? `${p.treinos + p.competicoes}/${p.minTreinos} eventos`
                      : `${p.treinos}/${p.minTreinos} treinos · ${p.competicoes}/${p.minCompeticoes} comp.`}
                  </span>
                </div>
              ))}
              <div className="text-[10px] text-stone-400 leading-relaxed">
                Eventos de mesmo grupo, dia e entidade contam uma única vez. A contagem é por grupo de arma representativa; o nível considera o menor grupo comprovado (Art. 98, §2º).
              </div>
            </div>
          )}

          <AnexoEBox sessions={sessions} profile={profile} config={config} />

          {/* Livro de registros */}
          <div>
            <div className="label mb-1.5">Livro de registros (imutável)</div>
            {sessions.length === 0 ? (
              <div className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-md p-2.5">
                Nenhum lançamento ainda. Toque em "lançar sessão" no dia do treino ou competição.
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((s) => (
                  <div key={s.id} className="card p-3 text-xs space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-navy">{s.numeroRegistro} · fl. {s.folha}</span>
                      <span className={`text-[9px] tracking-[0.1em] uppercase font-semibold px-1.5 py-0.5 rounded ${
                        s.uso === 'restrito' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        grupo {s.grupo} · {s.uso}
                      </span>
                    </div>
                    <div className="text-stone-600">
                      {fmtDH(s.dataHoraEvento)} · {s.arma?.marca} {s.arma?.modelo} {s.arma?.calibre} · SIGMA {s.arma?.sigma}
                    </div>
                    <div className="text-stone-600">
                      {s.qtdMunicao} un {s.municaoCalibre} · {s.tipoEvento === 'competicao' ? `competição (${s.nivelCompeticao})` : 'treinamento'} · {s.atividade}
                    </div>
                    <div className="text-[10px] text-stone-400">
                      lançado em {fmtDH(s.dataLancamento)} · {s.livroSistema} · presença: app
                      {s.geo?.lat ? ` · geo ${Number(s.geo.lat).toFixed(4)},${Number(s.geo.lng).toFixed(4)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isAdmin && <SfpcBox />}
        </>
      )}
    </main>
  )
}

// ============ Cadastro CR/CPF (primeira vez) ============

function CadastroCR({ profile, onSave }) {
  const [cpf, setCpf] = useState(profile?.cpf || '')
  const [cr, setCr] = useState(profile?.cr_numero || '')
  const [crData, setCrData] = useState(profile?.cr_data || '')
  const [nivel, setNivel] = useState(profile?.nivel_habitualidade || '1')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    const cpfDigits = cpf.replace(/\D/g, '')
    if (cpfDigits.length !== 11) return setErr('CPF inválido (11 dígitos).')
    if (!cr.trim()) return setErr('Informe o número do seu CR.')
    setErr(null)
    setSaving(true)
    try {
      await onSave({
        cpf: cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
        cr_numero: cr.trim(),
        cr_data: crData || null,
        nivel_habitualidade: nivel,
      })
    } catch (e) {
      setErr(e.message || 'Erro ao salvar')
      setSaving(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="text-sm font-semibold text-navy">Primeiro acesso: cadastro do atirador</div>
      <div className="text-[11px] text-stone-600 bg-stone-50 border border-stone-200 rounded-md p-2.5 leading-relaxed">
        CR e CPF entram em todo registro de habitualidade e na Declaração (Anexo E). Você cadastra uma vez; nas próximas, já compõe o seu cadastro.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="label mb-1.5">CPF</div>
          <input className="input" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
        </div>
        <div className="min-w-0">
          <div className="label mb-1.5">Nº do CR</div>
          <input className="input" value={cr} onChange={(e) => setCr(e.target.value)} placeholder="ex: 123456" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="label mb-1.5">Data do CR</div>
          <DateField value={crData} onChange={(e) => setCrData(e.target.value)} />
        </div>
        <div className="min-w-0">
          <div className="label mb-1.5">Nível</div>
          <select className="input" value={nivel} onChange={(e) => setNivel(e.target.value)}>
            <option value="1">Nível 1</option>
            <option value="2">Nível 2</option>
            <option value="3">Nível 3</option>
            <option value="alto_rendimento">Alto rendimento</option>
          </select>
        </div>
      </div>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}
      <button onClick={save} disabled={saving}
        className="w-full px-4 py-3 bg-navy text-white text-sm font-semibold rounded-md border-b-2 border-gold disabled:opacity-50 transition">
        {saving ? 'salvando…' : 'salvar cadastro'}
      </button>
    </div>
  )
}

// ============ Lancamento de sessao ============

function LaunchForm({ userId, guns, config, onDone }) {
  const [gunId, setGunId] = useState('')
  const [qtd, setQtd] = useState('')
  const [tipoEvento, setTipoEvento] = useState('treinamento')
  const [nivelComp, setNivelComp] = useState('estadual')
  const [atividade, setAtividade] = useState('')
  const [selfie, setSelfie] = useState(null)
  const [geo, setGeo] = useState(null)
  const [geoErr, setGeoErr] = useState(null)
  const [cedentePresente, setCedentePresente] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const fileRef = useRef(null)

  const gun = guns.find((g) => g.id === gunId)
  const classif = gun ? classificarClubGun(gun) : null
  const entidade = config?.entidade || {}
  const responsavel = config?.responsavel || {}

  const captureGeo = () => {
    setGeoErr(null)
    if (!navigator.geolocation) { setGeoErr('Geolocalização indisponível neste aparelho.'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        capturado_em: new Date().toISOString(),
      }),
      (e) => setGeoErr('Sem localização: ' + (e.message || 'permissão negada')),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const onSelfie = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const compressed = await compressDataUrl(ev.target.result)
      setSelfie(compressed)
      captureGeo() // selfie georreferenciada: captura a posicao junto
    }
    reader.readAsDataURL(file)
  }

  const launch = async () => {
    if (!gun) return setErr('Escolha a arma do acervo da entidade.')
    const n = parseInt(qtd)
    if (!n || n <= 0) return setErr('Informe o consumo de munição.')
    if (!atividade.trim()) return setErr('Descreva o evento/atividade.')
    if (!selfie) return setErr('Tire a selfie de presença.')
    if (!cedentePresente) return setErr('Confirme a presença física do cedente (obrigatória na cessão).')
    setErr(null)
    setSaving(true)
    try {
      const selfiePath = await uploadHabitSelfie(userId, selfie)
      const res = await registerHabitSession({
        gunId: gun.id,
        dataHoraEvento: new Date().toISOString(),
        qtdMunicao: n,
        tipoEvento,
        nivelCompeticao: tipoEvento === 'competicao' ? nivelComp : null,
        atividade: atividade.trim(),
        grupo: classif.grupo,
        uso: classif.uso,
        inciso: classif.inciso,
        selfiePath,
        geo,
        presencaFisicaCedente: cedentePresente,
      })
      setDone(res)
    } catch (e) {
      setErr(e.message || 'Erro ao lançar')
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="card p-4 space-y-2">
        <div className="text-sm font-semibold text-emerald-700">Sessão lançada no livro eletrônico</div>
        <div className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-md p-3 space-y-0.5">
          <div><span className="text-stone-400">Livro/Sistema:</span> StrikeCore</div>
          <div><span className="text-stone-400">Nº Registro:</span> <strong>{done.numero_registro}</strong> · fl. {done.folha}</div>
          <div><span className="text-stone-400">Data do lançamento:</span> {fmtDH(done.data_lancamento)}</div>
          <div><span className="text-stone-400">Classificação:</span> grupo {done.grupo} · uso {done.uso} ({done.inciso})</div>
        </div>
        <div className="text-[10px] text-stone-400 leading-relaxed">Registro imutável (retenção permanente). Correção é um novo lançamento, nunca edição.</div>
        <button onClick={onDone} className="w-full px-4 py-2.5 bg-navy text-white text-xs font-semibold rounded-md border-b-2 border-gold">concluir</button>
      </div>
    )
  }

  return (
    <div className="card p-4 space-y-4">
      <div className="text-sm font-semibold text-navy">Lançar sessão de habitualidade</div>

      <div>
        <div className="label mb-1.5">Arma do acervo da entidade</div>
        <div className="space-y-1.5">
          {guns.map((g) => {
            const c = classificarClubGun(g)
            const sel = gunId === g.id
            return (
              <button key={g.id} type="button" onClick={() => setGunId(g.id)}
                className={`w-full text-left px-3 py-2.5 rounded-md border text-xs transition ${
                  sel ? 'border-navy bg-navy/5' : 'border-stone-200 bg-white hover:border-stone-300'
                }`}>
                <div className="font-semibold text-stone-800">{g.tipo} {g.marca} {g.modelo} · {g.calibre}</div>
                <div className="text-[10px] text-stone-500 mt-0.5">Série {g.serie} · SIGMA {g.sigma}</div>
                <div className={`text-[10px] font-semibold mt-0.5 ${c.uso === 'restrito' ? 'text-red-700' : 'text-emerald-700'}`}>
                  {GRUPO_LABELS[c.grupo]}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="label mb-1.5">Munição (un)</div>
          <input type="number" inputMode="numeric" className="input" value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="50" />
        </div>
        <div className="min-w-0">
          <div className="label mb-1.5">Calibre</div>
          <div className="input bg-stone-50 text-stone-500">{gun?.calibre || '—'}</div>
        </div>
      </div>

      <div>
        <div className="label mb-1.5">Tipo de evento</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setTipoEvento('treinamento')}
            className={`px-2 py-2 text-xs font-semibold rounded-md border transition ${tipoEvento === 'treinamento' ? 'bg-navy text-white border-navy' : 'bg-white text-stone-600 border-stone-200'}`}>
            treinamento
          </button>
          <button type="button" onClick={() => setTipoEvento('competicao')}
            className={`px-2 py-2 text-xs font-semibold rounded-md border transition ${tipoEvento === 'competicao' ? 'bg-navy text-white border-navy' : 'bg-white text-stone-600 border-stone-200'}`}>
            competição
          </button>
        </div>
        {tipoEvento === 'competicao' && (
          <select className="input mt-2" value={nivelComp} onChange={(e) => setNivelComp(e.target.value)}>
            <option value="estadual">Estadual</option>
            <option value="distrital">Distrital</option>
            <option value="regional">Regional</option>
            <option value="nacional">Nacional</option>
            <option value="internacional">Internacional</option>
          </select>
        )}
      </div>

      <div>
        <div className="label mb-1.5">Evento / atividade</div>
        <input className="input" value={atividade} onChange={(e) => setAtividade(e.target.value)}
          placeholder="ex: treino de precisão 25m" />
      </div>

      <div>
        <div className="label mb-1.5">Selfie de presença (georreferenciada)</div>
        {selfie ? (
          <div className="flex items-center gap-3">
            <img src={selfie} alt="selfie" className="w-16 h-16 rounded-md object-cover border border-stone-200" />
            <div className="text-[11px] text-stone-600 leading-relaxed">
              {geo ? `localização capturada (±${Math.round(geo.accuracy)}m)` : geoErr || 'capturando localização…'}
              <button type="button" onClick={() => { setSelfie(null); setGeo(null); if (fileRef.current) fileRef.current.value = '' }}
                className="block text-red-600 underline mt-0.5">refazer</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full px-4 py-3 bg-white border-2 border-dashed border-stone-300 hover:border-navy text-sm font-semibold text-stone-600 rounded-md transition">
            tirar selfie
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onSelfie} />
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-md p-3 space-y-2">
        <div className="text-[10px] tracking-[0.14em] uppercase text-stone-400 font-semibold">Termo de cessão (arma da entidade)</div>
        <div className="text-[11px] text-stone-600 leading-relaxed">
          Cedente: <strong>{entidade.nome}</strong>, CNPJ {entidade.cnpj}, {entidade.endereco}. Assina: <strong>{responsavel.nome}</strong>, {responsavel.cargo}. SIGMA da arma cedida: {gun?.sigma || '—'}.
        </div>
        <label className="flex items-start gap-2 text-xs text-stone-700">
          <input type="checkbox" checked={cedentePresente} onChange={(e) => setCedentePresente(e.target.checked)} className="mt-0.5" />
          <span>Declaro a <strong>presença física do cedente</strong> no ato (obrigatória — Ofício Circular nº 8/2025).</span>
        </label>
      </div>

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}

      <button onClick={launch} disabled={saving}
        className="w-full px-4 py-3 bg-navy text-white text-sm font-semibold rounded-md border-b-2 border-gold disabled:opacity-50 transition">
        {saving ? 'lançando…' : 'assinar presença e lançar (imutável)'}
      </button>
      <div className="text-[10px] text-stone-400 leading-relaxed -mt-2">
        Sua autenticação no app + selfie + timestamp valem como atestado de presença. O responsável legal não assina por sessão: a assinatura dele entra só no Anexo E e no pacote mensal do SFPC.
      </div>
    </div>
  )
}

// ============ Anexo E (sob demanda) ============

function AnexoEBox({ sessions, profile, config }) {
  const [inicio, setInicio] = useState(() => toDateInput(new Date(Date.now() - 365 * 24 * 3600 * 1000)))
  const [fim, setFim] = useState(() => toDateInput(new Date()))
  const [err, setErr] = useState(null)

  const gerar = () => {
    try {
      setErr(null)
      const ini = new Date(`${inicio}T00:00:00`)
      const end = new Date(`${fim}T23:59:59`)
      const doPeriodo = sessions
        .filter((s) => { const d = new Date(s.dataHoraEvento); return d >= ini && d <= end })
        .map((s) => ({
          // formato que o builder espera (snake do banco)
          data_hora_evento: s.dataHoraEvento,
          data_lancamento: s.dataLancamento,
          numero_registro: s.numeroRegistro,
          folha: s.folha,
          arma_snapshot: s.arma,
          grupo_no_evento: s.grupo,
          uso: s.uso,
          inciso_legal: s.inciso,
          qtd_municao: s.qtdMunicao,
          municao_calibre: s.municaoCalibre,
          tipo_evento: s.tipoEvento,
          nivel_competicao: s.nivelCompeticao,
          atividade_desc: s.atividade,
        }))
      const doc = buildAnexoE({
        sessions: doPeriodo,
        atirador: {
          nome: profile?.nickname || profile?.display_name || '',
          cpf: profile?.cpf,
          cr: profile?.cr_numero,
          crData: profile?.cr_data,
          nivel: profile?.nivel_habitualidade || '1',
        },
        config,
        periodo: { inicio: `${inicio}T00:00:00`, fim: `${fim}T00:00:00` },
      })
      doc.save(`anexo_e_${inicio}_${fim}.pdf`)
    } catch (e) {
      setErr(e.message || 'Erro ao gerar o Anexo E')
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="text-xs tracking-[0.18em] uppercase text-gold font-semibold">Declaração de Habitualidade · Anexo E</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="label mb-1.5">De</div>
          <DateField value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="min-w-0">
          <div className="label mb-1.5">Até</div>
          <DateField value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
      </div>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}
      <button onClick={gerar}
        className="w-full px-4 py-2.5 bg-white border border-navy text-navy text-xs font-semibold rounded-md hover:bg-stone-50 transition">
        gerar PDF do Anexo E
      </button>
      <div className="text-[10px] text-stone-400 leading-relaxed">
        PDF em papel timbrado da entidade, pronto pra assinatura digital ICP-Brasil ou gov.br do responsável legal ({config?.responsavel?.nome || '—'}).
      </div>
    </div>
  )
}

// ============ Pacote SFPC mensal (admin) ============

function SfpcBox() {
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [ano, setAno] = useState(prev.getFullYear())
  const [mes, setMes] = useState(prev.getMonth() + 1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const gerar = async () => {
    setBusy(true)
    setErr(null)
    try {
      const comp = `${ano}-${String(mes).padStart(2, '0')}-01`
      const pkg = await habitSfpcExport(comp)
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `sfpc_${ano}-${String(mes).padStart(2, '0')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setErr(e.message || 'Erro ao gerar pacote')
    } finally {
      setBusy(false)
    }
  }

  const anos = [now.getFullYear() - 1, now.getFullYear()]
  return (
    <div className="card p-4 space-y-3">
      <div className="text-xs tracking-[0.18em] uppercase text-gold font-semibold">Pacote SFPC (admin) · mensal até o dia 10</div>
      <div className="grid grid-cols-2 gap-3">
        <select className="input" value={mes} onChange={(e) => setMes(parseInt(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => (<option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>))}
        </select>
        <select className="input" value={ano} onChange={(e) => setAno(parseInt(e.target.value))}>
          {anos.map((a) => (<option key={a} value={a}>{a}</option>))}
        </select>
      </div>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}
      <button onClick={gerar} disabled={busy}
        className="w-full px-4 py-2.5 bg-white border border-navy text-navy text-xs font-semibold rounded-md hover:bg-stone-50 disabled:opacity-50 transition">
        {busy ? 'gerando…' : 'baixar pacote da competência (JSON)'}
      </button>
      <div className="text-[10px] text-stone-400 leading-relaxed">
        Snapshot de acervo, atiradores e atividades do mês. O canal e formato oficiais de envio eletrônico ao SFPC seguem em validação (Art. 52, parágrafo único).
      </div>
    </div>
  )
}
