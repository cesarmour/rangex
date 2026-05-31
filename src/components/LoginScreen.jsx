import { useState } from 'react'
import { getCurrentPosition, findNearbyRanges } from '../lib/location.js'

const FEATURED_PATTERNS = ['g16 premium', 'g16 unique']

function isFeatured(name = '') {
  const n = name.toLowerCase()
  return FEATURED_PATTERNS.some((p) => n.includes(p))
}

export default function LoginScreen({ onSelect }) {
  const [state, setState] = useState('initial')
  const [ranges, setRanges] = useState([])
  const [error, setError] = useState(null)
  const [manualName, setManualName] = useState('')

  const findRanges = async () => {
    setError(null)
    setState('locating')
    try {
      const pos = await getCurrentPosition()
      const found = await findNearbyRanges(pos)
      if (found.length === 0) {
        setError('Nenhum clube de tiro encontrado num raio de 50km.')
        setState('error')
        return
      }
      const sorted = [...found].sort((a, b) => {
        const fa = isFeatured(a.name) ? 0 : 1
        const fb = isFeatured(b.name) ? 0 : 1
        if (fa !== fb) return fa - fb
        return a.distance - b.distance
      })
      setRanges(sorted)
      setState('results')
    } catch (e) {
      setError(e.message || 'Erro desconhecido')
      setState('error')
    }
  }

  const selectRange = (range) => {
    onSelect({
      name: range.name,
      address: range.address || '',
      placeId: range.place_id,
    })
  }

  const selectManual = () => {
    const name = manualName.trim()
    if (!name) return
    onSelect({ name, address: '', placeId: null })
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/range-bg.jpeg)' }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-navy/85 via-navy/75 to-navy/95" aria-hidden="true" />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 0%, rgba(5,11,21,0.4) 100%)' }}
        aria-hidden="true"
      />

      <div className="relative z-10 min-h-screen flex flex-col text-white">
        <div className="flex-1 flex flex-col px-6 pt-20 pb-8 max-w-md mx-auto w-full">
          <div className="mb-12">
            <div className="text-4xl font-light tracking-[0.1em] mb-2">STRIKECORE</div>
            <div className="text-[10px] tracking-[0.32em] text-gold uppercase font-light mb-4">
              Shooting Analytics
            </div>
            <div className="h-[2px] w-12 bg-gold mb-3" />
            <div className="text-[11px] tracking-[0.18em] text-stone-200 uppercase">
              Seleção de clube
            </div>
          </div>

          {state === 'initial' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h2 className="text-xl font-light leading-tight">
                  Onde você vai treinar hoje?
                </h2>
                <p className="text-sm text-stone-300 leading-relaxed">
                  Permita acesso à sua localização e o app sugere os clubes de tiro mais próximos.
                </p>
              </div>
              <button
                onClick={findRanges}
                className="w-full px-4 py-4 bg-gold text-navy text-sm font-bold tracking-wide rounded-md hover:opacity-90 transition active:scale-[0.98]"
              >
                BUSCAR CLUBES PRÓXIMOS
              </button>
              <button
                onClick={() => setState('manual')}
                className="w-full text-xs text-stone-300 hover:text-white py-2 underline"
              >
                ou inserir nome manualmente
              </button>
            </div>
          )}

          {state === 'locating' && (
            <div className="text-center space-y-4 mt-8">
              <div className="inline-block">
                <Spinner />
              </div>
              <div className="text-sm text-stone-300">Buscando clubes próximos…</div>
            </div>
          )}

          {state === 'results' && (
            <div className="space-y-4">
              <h2 className="text-[11px] font-semibold text-gold tracking-[0.18em] uppercase">
                Clubes próximos
              </h2>
              <div className="space-y-2">
                {ranges.map((r) => {
                  const featured = isFeatured(r.name)
                  return (
                    <button
                      key={r.place_id}
                      onClick={() => selectRange(r)}
                      className={`w-full text-left p-4 backdrop-blur-sm rounded-md transition active:scale-[0.98] relative ${
                        featured
                          ? 'bg-gradient-to-br from-gold/25 to-gold/10 hover:from-gold/30 hover:to-gold/15 border-2 border-gold'
                          : 'bg-black/30 hover:bg-black/40 border border-white/15'
                      }`}
                    >
                      {featured && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <AwardIcon className="w-4 h-4 text-gold flex-shrink-0" />
                          <span className="text-[9px] font-bold tracking-[0.18em] uppercase text-gold">
                            Melhor clube da região
                          </span>
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-semibold leading-tight ${featured ? 'text-white' : ''}`}>
                            {r.name}
                          </div>
                          <div className="text-[11px] text-stone-300 mt-1 leading-relaxed">
                            {r.address}
                          </div>
                          {r.rating && (
                            <div className="text-[11px] text-stone-300 mt-1">
                              <span className="text-gold">{r.rating.toFixed(1)}</span>
                              {r.userRatingsTotal ? <span className="text-stone-400"> ({r.userRatingsTotal})</span> : null}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-gold font-semibold flex-shrink-0">
                          {r.distanceLabel}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => setState('manual')}
                className="w-full text-xs text-stone-300 hover:text-white py-2 underline"
              >
                não está na lista? digite manualmente
              </button>
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-900/40 border border-red-900/60 backdrop-blur-sm rounded-md text-sm">
                {error}
              </div>
              <button
                onClick={findRanges}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 backdrop-blur-sm rounded-md text-sm font-semibold hover:bg-white/15 transition"
              >
                tentar novamente
              </button>
              <button
                onClick={() => setState('manual')}
                className="w-full px-4 py-3 bg-gold text-navy rounded-md text-sm font-bold tracking-wide hover:opacity-90 transition"
              >
                inserir manualmente
              </button>
            </div>
          )}

          {state === 'manual' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-base font-semibold tracking-wide">Nome do clube</h2>
                <p className="text-xs text-stone-300">
                  Esse nome vai aparecer no header e nos relatórios.
                </p>
              </div>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Ex: Clube de Tiro Bandeirante"
                className="w-full px-4 py-3 bg-black/30 backdrop-blur-sm border border-white/20 rounded-md text-sm placeholder:text-stone-400 focus:outline-none focus:border-gold text-white"
                autoFocus
              />
              <button
                onClick={selectManual}
                disabled={!manualName.trim()}
                className="w-full px-4 py-3 bg-gold text-navy rounded-md text-sm font-bold tracking-wide hover:opacity-90 disabled:opacity-50 transition"
              >
                continuar
              </button>
              <button
                onClick={() => setState('initial')}
                className="w-full text-xs text-stone-300 hover:text-white py-2 underline"
              >
                voltar
              </button>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 text-center text-[10px] text-stone-400 tracking-[0.2em] uppercase safe-bottom">
          STRIKECORE
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-8 w-8 text-gold" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function AwardIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  )
}
