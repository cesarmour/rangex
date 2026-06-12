import { useState, useMemo, useEffect, useRef } from 'react'
import { CALIBRES } from '../lib/defaults.js'
import { getAcervoPhotoUrl, uploadAcervoPhoto, deleteAcervoPhoto, searchArmas } from '../lib/db.js'

function computeArmaStats(trainings, arma) {
  let totalDisparos = 0
  let totalPontos = 0
  let bestPtsTiro = 0
  let bestDate = null
  let sessionsCount = 0
  let lastDate = null

  for (const t of trainings) {
    for (const s of t.sessions || []) {
      if (s.arma === arma && s.disparos > 0) {
        sessionsCount++
        totalDisparos += Number(s.disparos) || 0
        totalPontos += Number(s.pontos) || 0
        const pts = s.pontos / s.disparos
        if (pts > bestPtsTiro) {
          bestPtsTiro = pts
          bestDate = t.trainedAt
        }
        if (!lastDate || new Date(t.trainedAt) > new Date(lastDate)) {
          lastDate = t.trainedAt
        }
      }
    }
  }

  return {
    sessionsCount,
    totalDisparos,
    totalPontos,
    avgPtsTiro: totalDisparos > 0 ? totalPontos / totalDisparos : 0,
    bestPtsTiro,
    bestDate,
    lastDate,
  }
}

// Compress image client-side before upload
async function compressImage(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
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
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function AcervoScreen({
  acervo,
  trainings,
  userId,
  onAddAcervo,
  onUpdateAcervo,
  onRemoveAcervo,
}) {
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [photoUrls, setPhotoUrls] = useState({}) // armaId -> signed URL
  const [uploadingId, setUploadingId] = useState(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  // Load signed URLs for photos
  useEffect(() => {
    let cancelled = false
    const loadUrls = async () => {
      const newUrls = {}
      for (const item of acervo) {
        if (item.photoPath && !photoUrls[item.id]) {
          const url = await getAcervoPhotoUrl(item.photoPath)
          if (url) newUrls[item.id] = url
        }
      }
      if (!cancelled && Object.keys(newUrls).length > 0) {
        setPhotoUrls((prev) => ({ ...prev, ...newUrls }))
      }
    }
    loadUrls()
    return () => { cancelled = true }
  }, [acervo])

  const armaStats = useMemo(() => {
    const map = new Map()
    for (const item of acervo) {
      map.set(item.id, computeArmaStats(trainings, item.arma))
    }
    return map
  }, [acervo, trainings])

  const sortedAcervo = useMemo(() => {
    return [...acervo].sort((a, b) => {
      const sA = armaStats.get(a.id) || { sessionsCount: 0 }
      const sB = armaStats.get(b.id) || { sessionsCount: 0 }
      if (sB.sessionsCount !== sA.sessionsCount) return sB.sessionsCount - sA.sessionsCount
      return (a.arma || '').localeCompare(b.arma || '')
    })
  }, [acervo, armaStats])

  const totals = useMemo(() => {
    let totalArmas = acervo.length
    let totalDisparos = 0
    let totalSessions = 0
    let calibresSet = new Set()
    for (const item of acervo) {
      calibresSet.add(item.calibre)
      const s = armaStats.get(item.id) || {}
      totalDisparos += s.totalDisparos || 0
      totalSessions += s.sessionsCount || 0
    }
    return { totalArmas, totalDisparos, totalSessions, totalCalibres: calibresSet.size }
  }, [acervo, armaStats])

  const handlePhotoUpload = async (item, file) => {
    if (!file || !userId) return
    setUploadingId(item.id)
    try {
      const compressed = await compressImage(file, 1200, 0.82)
      const newPath = await uploadAcervoPhoto(userId, compressed)

      // Delete previous photo if exists
      if (item.photoPath) {
        deleteAcervoPhoto(item.photoPath).catch((e) => console.warn('delete old photo:', e))
      }

      onUpdateAcervo(item.id, { photoPath: newPath })

      // Refresh signed URL
      const url = await getAcervoPhotoUrl(newPath)
      setPhotoUrls((prev) => ({ ...prev, [item.id]: url }))
    } catch (e) {
      alert('Erro ao subir foto: ' + e.message)
    } finally {
      setUploadingId(null)
    }
  }

  const handleRemovePhoto = async (item) => {
    if (!confirm('Remover a foto desta arma?')) return
    if (item.photoPath) {
      deleteAcervoPhoto(item.photoPath).catch((e) => console.warn('delete photo:', e))
    }
    onUpdateAcervo(item.id, { photoPath: null })
    setPhotoUrls((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs tracking-[0.18em] uppercase text-gold font-semibold">Meu Acervo</div>
            <div className="text-[11px] text-stone-500 mt-0.5">Inventário CAC com histórico por arma</div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center pt-3 border-t border-stone-100">
          <Metric label="Armas" value={totals.totalArmas} />
          <Metric label="Calibres" value={totals.totalCalibres} />
          <Metric label="Sessões" value={totals.totalSessions} />
          <Metric label="Disparos" value={totals.totalDisparos.toLocaleString('pt-BR')} />
        </div>
      </div>

      <div className="space-y-2">
        {sortedAcervo.map((item) => {
          const stats = armaStats.get(item.id) || {}
          const isEditing = editing === item.id
          const isExpanded = expanded === item.id
          const hasHistory = stats.sessionsCount > 0
          const photoUrl = photoUrls[item.id]
          const isUploading = uploadingId === item.id

          return (
            <div key={item.id} className="card overflow-hidden">
              <div
                onClick={() => !isEditing && setExpanded(isExpanded ? null : item.id)}
                className="p-4 cursor-pointer hover:bg-stone-50 transition flex items-center gap-3"
              >
                {/* Avatar: photo or fallback caliber tag */}
                <ArmaAvatar
                  photoUrl={photoUrl}
                  calibre={item.calibre}
                  hasHistory={hasHistory}
                  onPhotoTap={(e) => {
                    e.stopPropagation()
                    if (photoUrl) setLightboxUrl(photoUrl)
                  }}
                  uploading={isUploading}
                />

                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        className="input"
                        value={item.arma}
                        onChange={(e) => onUpdateAcervo(item.id, { arma: e.target.value })}
                        placeholder="Nome da arma"
                        autoFocus
                      />
                      <select
                        className="input"
                        value={item.calibre}
                        onChange={(e) => onUpdateAcervo(item.id, { calibre: e.target.value })}
                      >
                        {CALIBRES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="font-semibold text-sm leading-tight">{item.arma || '—'}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5">
                        {item.calibre}
                        {hasHistory && (
                          <>
                            {' · '}
                            <span className="text-gold font-semibold">
                              {stats.sessionsCount} {stats.sessionsCount === 1 ? 'treino' : 'treinos'}
                            </span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {!isEditing && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {hasHistory && (
                      <div className="text-right mr-1">
                        <div className="text-xs font-bold text-navy">{stats.avgPtsTiro.toFixed(2)}</div>
                        <div className="text-[9px] text-stone-400 tracking-wider uppercase">pts/tiro</div>
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(item.id); setExpanded(null) }}
                      className="btn-ghost text-stone-400 hover:text-navy px-2"
                      title="Editar"
                    >
                      editar
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`Remover ${item.arma || 'esta arma'} do acervo?`)) {
                          if (item.photoPath) deleteAcervoPhoto(item.photoPath).catch(() => {})
                          onRemoveAcervo(item.id)
                        }
                      }}
                      className="btn-ghost text-red-600 px-2"
                      title="Remover"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>

              {/* Editing block */}
              {isEditing && (
                <div className="px-4 pb-4 pt-0 border-t border-stone-100 space-y-2">
                  <div className="pt-3">
                    <div className="label mb-2">Foto da arma</div>
                    <PhotoControls
                      photoUrl={photoUrl}
                      uploading={isUploading}
                      onUpload={(file) => handlePhotoUpload(item, file)}
                      onRemove={() => handleRemovePhoto(item)}
                    />
                  </div>
                  <button
                    onClick={() => setEditing(null)}
                    className="w-full px-3 py-2 bg-navy text-white text-xs font-semibold tracking-wide rounded-md hover:bg-navy-700 transition mt-2"
                  >
                    pronto
                  </button>
                </div>
              )}

              {isExpanded && !isEditing && (
                <div className="bg-stone-50 border-t border-stone-100 p-4 space-y-3">
                  {hasHistory ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <StatTile label="Total disparos" value={stats.totalDisparos.toLocaleString('pt-BR')} />
                        <StatTile label="Total pontos" value={stats.totalPontos.toLocaleString('pt-BR')} />
                        <StatTile label="Média pts/tiro" value={stats.avgPtsTiro.toFixed(2)} />
                        <StatTile label="Melhor pts/tiro" value={stats.bestPtsTiro.toFixed(2)} gold />
                      </div>
                      <div className="text-[11px] text-stone-500 space-y-0.5 pt-2 border-t border-stone-200">
                        {stats.bestDate && <div>Melhor sessão: {new Date(stats.bestDate).toLocaleDateString('pt-BR')}</div>}
                        {stats.lastDate && <div>Último treino: {new Date(stats.lastDate).toLocaleDateString('pt-BR')}</div>}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-3">
                      <div className="text-[11px] text-stone-400">Sem histórico ainda</div>
                      <div className="text-[10px] text-stone-300 mt-1">Use essa arma em um treino pra começar a registrar</div>
                    </div>
                  )}
                  {!photoUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(item.id); setExpanded(null) }}
                      className="w-full px-3 py-2 bg-white border border-stone-200 hover:border-navy text-xs font-semibold tracking-wide rounded-md transition"
                    >
                      adicionar foto
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!adding && (
      <button
        onClick={() => setAdding(true)}
        className="w-full px-4 py-3 bg-white border-2 border-dashed border-stone-300 hover:border-navy hover:bg-stone-50 text-sm font-semibold text-stone-600 rounded-md transition"
      >
        + adicionar nova arma
      </button>
      )}

      {adding && (
        <NewArmaForm
          onCancel={() => setAdding(false)}
          onSave={async (data) => {
            await onAddAcervo(data)
            setAdding(false)
          }}
        />
      )}

      {acervo.length === 0 && (
        <div className="text-center py-8 text-stone-400">
          <div className="text-sm">Seu acervo está vazio</div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full object-contain rounded" />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            ×
          </button>
        </div>
      )}
    </main>
  )
}

function ArmaAvatar({ photoUrl, calibre, hasHistory, onPhotoTap, uploading }) {
  if (uploading) {
    return (
      <div className="w-14 h-14 rounded-md bg-stone-100 flex items-center justify-center flex-shrink-0">
        <Spinner />
      </div>
    )
  }
  if (photoUrl) {
    return (
      <button
        onClick={onPhotoTap}
        className="relative w-14 h-14 rounded-md overflow-hidden flex-shrink-0 hover:opacity-90 transition"
      >
        <img src={photoUrl} alt="" className="w-full h-full object-cover" />
        {hasHistory && (
          <div className="absolute top-0 right-0 w-3 h-3 rounded-full bg-gold border-2 border-white" />
        )}
      </button>
    )
  }
  return (
    <div className="w-14 h-14 rounded-md bg-navy text-white flex items-center justify-center flex-shrink-0 relative">
      <div className="text-[10px] tracking-tight leading-none text-center px-1">
        {calibre?.split(' ')[0] || '—'}
      </div>
      {hasHistory && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-gold border-2 border-white" />
      )}
    </div>
  )
}

function PhotoControls({ photoUrl, uploading, onUpload, onRemove }) {
  const fileInputRef = useRef(null)

  return (
    <div className="space-y-2">
      {photoUrl && (
        <div className="rounded-md overflow-hidden border border-stone-200 max-h-64">
          <img src={photoUrl} alt="" className="w-full h-full object-contain max-h-64 bg-stone-100" />
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          e.target.value = '' // reset to allow re-uploading same file
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-3 py-2 bg-white border border-stone-200 hover:border-navy text-xs font-semibold tracking-wide rounded-md transition disabled:opacity-50"
        >
          {uploading ? 'enviando…' : photoUrl ? 'trocar foto' : 'escolher foto'}
        </button>
        {photoUrl && (
          <button
            onClick={onRemove}
            disabled={uploading}
            className="px-3 py-2 bg-red-50 border border-red-200 text-red-600 text-xs font-semibold tracking-wide rounded-md hover:bg-red-100 transition disabled:opacity-50"
          >
            remover foto
          </button>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-base font-light text-navy">{value}</div>
      <div className="text-[9px] tracking-[0.12em] uppercase text-stone-400 mt-0.5">{label}</div>
    </div>
  )
}

function StatTile({ label, value, gold }) {
  return (
    <div className="bg-white rounded-md border border-stone-200 p-2.5">
      <div className="text-[9px] tracking-[0.15em] uppercase text-stone-400 mb-0.5">{label}</div>
      <div className={`text-base font-light ${gold ? 'text-gold' : 'text-navy'}`}>{value}</div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-navy" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// Form de nova arma: nome + calibre preenchidos ANTES de salvar (a arma nao
// entra mais vazia/"9mm" perdida na lista). Busca no catalogo global pra
// autocompletar modelos ja cadastrados por outros usuarios.
function NewArmaForm({ onCancel, onSave }) {
  const [nome, setNome] = useState('')
  const [calibre, setCalibre] = useState(CALIBRES[0] || '9mm Luger')
  const [sugestoes, setSugestoes] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (nome.trim().length < 2) { setSugestoes([]); return }
    const t = setTimeout(async () => {
      try { setSugestoes(await searchArmas(nome.trim())) } catch { setSugestoes([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [nome])

  const save = async () => {
    if (!nome.trim()) { setErr('Dê um nome pra arma.'); return }
    setErr(null)
    setSaving(true)
    try {
      await onSave({ arma: nome.trim(), calibre })
    } catch (e) {
      setErr(e.message || 'Erro ao salvar')
      setSaving(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="text-xs font-semibold text-navy">Nova arma</div>
      <div>
        <div className="label mb-1.5">Modelo</div>
        <input className="input" autoFocus value={nome} onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Glock G17 Gen5" />
        {sugestoes.length > 0 && (
          <div className="mt-1 border border-stone-200 rounded-md divide-y divide-stone-100 bg-white overflow-hidden">
            {sugestoes.slice(0, 5).map((sug, i) => (
              <button key={i} type="button"
                onClick={() => { setNome(sug.arma); setCalibre(sug.calibre); setSugestoes([]) }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-stone-50 flex items-center justify-between">
                <span className="font-semibold text-stone-700">{sug.arma} · {sug.calibre}</span>
                <span className="text-[10px] text-stone-400">{sug.usuarios} atirador{sug.usuarios > 1 ? 'es' : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="label mb-1.5">Calibre</div>
        <select className="input" value={calibre} onChange={(e) => setCalibre(e.target.value)}>
          {!CALIBRES.includes(calibre) && <option value={calibre}>{calibre}</option>}
          {CALIBRES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </div>
      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{err}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="px-3 py-2.5 text-xs font-semibold rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 transition">cancelar</button>
        <button onClick={save} disabled={saving}
          className="px-3 py-2.5 text-xs font-semibold rounded-md bg-navy text-white border-b-2 border-gold disabled:opacity-50 transition">
          {saving ? 'salvando…' : 'salvar no acervo'}
        </button>
      </div>
    </div>
  )
}
