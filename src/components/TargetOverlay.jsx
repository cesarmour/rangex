import { useRef, useState, useEffect } from 'react'
import { rescoreScoring, QUADRANT_NAMES } from '../lib/scoring.js'
import { calibrationFromFrame, normalizeFrame, DEFAULT_FRAME, getTarget } from '../lib/targets.js'

// Overlay dos furos sobre a foto do alvo.
// Coordenadas ja estao em espaco de imagem (fracao 0..1 da imagem inteira).
//
// Props:
//   photo: data URL
//   scoring: de scoreHoles()
//   editable: liga edicao de furos (arrastar/adicionar/remover)
//   onScoringChange: (newScoring) => void
//   frame: { x0,y0,x1,y1 } area de analise (fracoes da imagem)
//   targetType: 'fc4' | 'single'
//   frameEditable: mostra o quadro e os cantos ajustaveis
//   onFrameChange: (newFrame) => void  chamado ao soltar um canto

const HIT_RING_COLORS = {
  bull: '#10b981',
  r5: '#3b82f6',
  r4: '#f59e0b',
  r3: '#ef4444',
  fora: '#9ca3af',
}

const CORNERS = [
  { id: 'tl', fx: 'x0', fy: 'y0' },
  { id: 'tr', fx: 'x1', fy: 'y0' },
  { id: 'bl', fx: 'x0', fy: 'y1' },
  { id: 'br', fx: 'x1', fy: 'y1' },
]

export default function TargetOverlay({
  photo, scoring, editable = false, onScoringChange,
  frame, targetType = 'fc4', frameEditable = false, onFrameChange,
}) {
  const imgRef = useRef(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [hoveredHit, setHoveredHit] = useState(null)
  const [drag, setDrag] = useState(null)        // arraste de marca de furo
  const [frameDrag, setFrameDrag] = useState(null) // { corner, frame } durante o arraste do quadro
  const draggedRef = useRef(false)
  const dragStartRef = useRef(null)

  const pointToFraction = (e) => {
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  useEffect(() => {
    const update = () => {
      if (imgRef.current) setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [photo])

  if (!photo) return null

  const effFrame = frameDrag ? frameDrag.frame : normalizeFrame(frame || DEFAULT_FRAME)

  // Furos achatados de todos os quadrantes (pra render).
  const allHits = []
  for (const q of QUADRANT_NAMES) {
    const qData = scoring?.quadrantes?.[q]
    if (!qData) continue
    qData.hits.forEach((h, idx) => { allHits.push({ ...h, quadrant: q, idx }) })
  }

  const editAndRescore = (mutate) => {
    const next = { ...scoring, quadrantes: {} }
    for (const q of QUADRANT_NAMES) {
      const qd = scoring?.quadrantes?.[q]
      next.quadrantes[q] = qd ? { ...qd, hits: [...(qd.hits || [])] } : { hits: [] }
    }
    mutate(next)
    onScoringChange?.(rescoreScoring(next))
  }

  const handleImageClick = (e) => {
    if (!editable) return
    if (!imgRef.current) return
    if (draggedRef.current) { draggedRef.current = false; return }
    const { x, y } = pointToFraction(e)
    editAndRescore((next) => {
      const first = QUADRANT_NAMES.find((q) => next.quadrantes[q]) || 'amarelo'
      if (!next.quadrantes[first].hits) next.quadrantes[first].hits = []
      next.quadrantes[first].hits.push({ x, y, confidence: 'manual' })
    })
  }

  const removeHit = (quadrant, idx) => {
    editAndRescore((next) => {
      const qd = next.quadrantes[quadrant]
      if (qd && qd.hits) qd.hits.splice(idx, 1)
    })
  }

  // ---- arraste de marca de furo ----
  const onMarkerDown = (e, quadrant, idx, hit) => {
    if (!editable) return
    e.stopPropagation()
    try { e.target.setPointerCapture(e.pointerId) } catch {}
    draggedRef.current = false
    dragStartRef.current = { x: hit.x, y: hit.y }
    setDrag({ quadrant, idx, x: hit.x, y: hit.y })
    setHoveredHit(null)
  }
  const onMarkerMove = (e) => {
    if (!drag) return
    e.stopPropagation()
    const { x, y } = pointToFraction(e)
    const start = dragStartRef.current
    if (start && (Math.abs(x - start.x) > 0.008 || Math.abs(y - start.y) > 0.008)) draggedRef.current = true
    setDrag((d) => (d ? { ...d, x, y } : d))
  }
  const onMarkerUp = (e, quadrant, idx) => {
    if (!editable) return
    e.stopPropagation()
    try { e.target.releasePointerCapture(e.pointerId) } catch {}
    const moved = draggedRef.current
    const d = drag
    setDrag(null)
    if (moved && d) {
      editAndRescore((next) => {
        const hits = next.quadrantes[quadrant]?.hits
        if (hits && hits[idx]) hits[idx] = { ...hits[idx], x: d.x, y: d.y, confidence: 'manual' }
      })
      setTimeout(() => { draggedRef.current = false }, 0)
    } else {
      removeHit(quadrant, idx)
    }
  }

  // ---- arraste do quadro (cantos) ----
  const onCornerDown = (e, corner) => {
    e.stopPropagation()
    try { e.target.setPointerCapture(e.pointerId) } catch {}
    draggedRef.current = true
    setFrameDrag({ corner, frame: { ...effFrame } })
  }
  const onCornerMove = (e) => {
    if (!frameDrag) return
    e.stopPropagation()
    const { x, y } = pointToFraction(e)
    const c = CORNERS.find((cc) => cc.id === frameDrag.corner)
    const MIN = 0.08
    const cand = { ...frameDrag.frame, [c.fx]: x, [c.fy]: y }
    // mantem x0<x1 e y0<y1 com folga minima durante o arraste
    if (c.fx === 'x0') cand.x0 = Math.min(cand.x0, cand.x1 - MIN)
    else cand.x1 = Math.max(cand.x1, cand.x0 + MIN)
    if (c.fy === 'y0') cand.y0 = Math.min(cand.y0, cand.y1 - MIN)
    else cand.y1 = Math.max(cand.y1, cand.y0 + MIN)
    cand.x0 = Math.max(0, cand.x0); cand.y0 = Math.max(0, cand.y0)
    cand.x1 = Math.min(1, cand.x1); cand.y1 = Math.min(1, cand.y1)
    setFrameDrag((d) => (d ? { ...d, frame: cand } : d))
  }
  const onCornerUp = (e) => {
    e.stopPropagation()
    try { e.target.releasePointerCapture(e.pointerId) } catch {}
    const committed = frameDrag ? normalizeFrame(frameDrag.frame) : null
    setFrameDrag(null)
    if (committed) onFrameChange?.(committed)
    setTimeout(() => { draggedRef.current = false }, 0)
  }

  // Aneis de preview a partir do quadro efetivo (atualiza ao vivo no arraste).
  const previewCal = calibrationFromFrame(effFrame, targetType).quadrants
  const target = getTarget(targetType)
  // centros unicos (single colapsa os 4 num so)
  const seen = new Set()
  const previewPatterns = QUADRANT_NAMES.map((q) => {
    const c = previewCal[q]
    const key = `${c.bull_center.x.toFixed(4)},${c.bull_center.y.toFixed(4)}`
    if (seen.has(key)) return null
    seen.add(key)
    return { q, ...c }
  }).filter(Boolean)

  const fpx = {
    x0: effFrame.x0 * imgSize.w, y0: effFrame.y0 * imgSize.h,
    x1: effFrame.x1 * imgSize.w, y1: effFrame.y1 * imgSize.h,
  }

  return (
    <div className="space-y-2">
      <div className="relative inline-block w-full select-none" style={{ touchAction: 'manipulation' }}>
        <img
          ref={imgRef}
          src={photo}
          alt="Alvo"
          className="w-full rounded-md block"
          onClick={handleImageClick}
          onLoad={() => { if (imgRef.current) setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight }) }}
          style={editable ? { cursor: 'crosshair' } : {}}
        />

        {imgSize.w > 0 && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
            preserveAspectRatio="none"
          >
            {/* Quadro de analise + divisores, so em modo de ajuste do quadro */}
            {frameEditable && (
              <g>
                <rect
                  x={fpx.x0} y={fpx.y0}
                  width={Math.max(0, fpx.x1 - fpx.x0)} height={Math.max(0, fpx.y1 - fpx.y0)}
                  fill="none" stroke="#facc15" strokeWidth={2} strokeDasharray="6 4" opacity={0.95}
                />
                {target.patterns.length > 1 && (
                  <g>
                    <line x1={(fpx.x0 + fpx.x1) / 2} y1={fpx.y0} x2={(fpx.x0 + fpx.x1) / 2} y2={fpx.y1}
                      stroke="rgba(250,204,21,0.5)" strokeWidth={1} strokeDasharray="4 4" />
                    <line x1={fpx.x0} y1={(fpx.y0 + fpx.y1) / 2} x2={fpx.x1} y2={(fpx.y0 + fpx.y1) / 2}
                      stroke="rgba(250,204,21,0.5)" strokeWidth={1} strokeDasharray="4 4" />
                  </g>
                )}
                {/* aneis de preview */}
                {previewPatterns.map((p, i) => {
                  const cx = p.bull_center.x * imgSize.w
                  const cy = p.bull_center.y * imgSize.h
                  const rings = [p.ring3_radius, p.ring4_radius, p.ring5_radius].filter((r) => r > 0)
                  return (
                    <g key={`pv${i}`}>
                      {rings.map((r, j) => (
                        <circle key={j} cx={cx} cy={cy} r={r * imgSize.w}
                          fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="2 3" />
                      ))}
                      <circle cx={cx} cy={cy} r={3} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={1} />
                    </g>
                  )
                })}
              </g>
            )}

            {/* Marcas de furo */}
            {allHits.map((hit, i) => {
              const isDragging = drag && drag.quadrant === hit.quadrant && drag.idx === hit.idx
              const hx = isDragging ? drag.x : hit.x
              const hy = isDragging ? drag.y : hit.y
              const cx = hx * imgSize.w
              const cy = hy * imgSize.h
              const isHovered = hoveredHit?.q === hit.quadrant && hoveredHit?.idx === hit.idx
              const ringColor = HIT_RING_COLORS[hit.zone] || '#9ca3af'
              const big = isHovered || isDragging
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={big ? 22 : 14} fill="none" stroke={ringColor} strokeWidth={2.5} opacity={0.9} />
                  <circle cx={cx} cy={cy} r={big ? 6 : 4} fill={ringColor} />
                  {(isHovered || isDragging) && (
                    <g>
                      <rect x={cx + 12} y={cy - 24} width={86} height={20} rx={3} fill="rgba(0,0,0,0.9)" />
                      <text x={cx + 55} y={cy - 10} fontSize="11" fill="white" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                        {labelForZone(hit.zone)} · {hit.points}pt
                      </text>
                    </g>
                  )}
                  {editable && (
                    <circle cx={cx} cy={cy} r={20} fill="transparent"
                      style={{ pointerEvents: 'auto', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                      onPointerDown={(e) => onMarkerDown(e, hit.quadrant, hit.idx, hit)}
                      onPointerMove={onMarkerMove}
                      onPointerUp={(e) => onMarkerUp(e, hit.quadrant, hit.idx)}
                      onMouseEnter={() => !drag && setHoveredHit({ q: hit.quadrant, idx: hit.idx })}
                      onMouseLeave={() => setHoveredHit(null)} />
                  )}
                </g>
              )
            })}

            {/* Cantos do quadro (alvo de arraste grande pra dedo) */}
            {frameEditable && CORNERS.map((c) => {
              const cx = effFrame[c.fx] * imgSize.w
              const cy = effFrame[c.fy] * imgSize.h
              return (
                <g key={c.id}>
                  <circle cx={cx} cy={cy} r={7} fill="#facc15" stroke="#1f2937" strokeWidth={1.5} />
                  <circle cx={cx} cy={cy} r={22} fill="transparent"
                    style={{ pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
                    onPointerDown={(e) => onCornerDown(e, c.id)}
                    onPointerMove={onCornerMove}
                    onPointerUp={onCornerUp} />
                </g>
              )
            })}
          </svg>
        )}
      </div>

      {/* Resumo + legenda */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-stone-500 px-1">
        <span className="font-semibold text-stone-700">
          {scoring?.total_disparos || 0} disparos · {scoring?.total_pontos || 0} pts
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.bull }} />
          mosca/5 (5)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.r4 }} />
          anel 4
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.r3 }} />
          anel 3
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.fora }} />
          fora
        </span>
      </div>

      {editable && (
        <div className="text-[10px] text-stone-500 px-1 leading-relaxed">
          {frameEditable
            ? 'Arraste os cantos amarelos pra encaixar o quadro no alvo: os anéis de cada padrão acompanham. Depois use "redetectar no quadro" ou marque os furos na mão. Arraste uma marca pra ajustá-la, toque numa marca pra remover, toque em outro lugar pra adicionar.'
            : 'Arraste uma marca pra ajustá-la sobre o furo real. Toque numa marca pra removê-la. Toque em qualquer outro lugar da foto pra adicionar um furo. A pontuação recalcula a cada ajuste.'}
        </div>
      )}
    </div>
  )
}

function labelForZone(zone) {
  return { bull: 'mosca', r5: 'anel 5', r4: 'anel 4', r3: 'anel 3', fora: 'fora' }[zone] || zone
}
