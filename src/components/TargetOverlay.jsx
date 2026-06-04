import { useRef, useState, useEffect } from 'react'
import { rescoreScoring, QUADRANT_NAMES } from '../lib/scoring.js'

// Visual overlay of hits on the target photo.
// Coordinates are already in image space (0..1 of the full image).
//
// Props:
//   photo: data URL
//   scoring: from scoreHoles()
//   editable: boolean
//   onScoringChange: (newScoring) => void

const HIT_RING_COLORS = {
  bull: '#10b981',
  r5: '#3b82f6',
  r4: '#f59e0b',
  r3: '#ef4444',
  fora: '#9ca3af',
}

export default function TargetOverlay({ photo, scoring, editable = false, onScoringChange }) {
  const imgRef = useRef(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [hoveredHit, setHoveredHit] = useState(null)
  const [drag, setDrag] = useState(null) // { quadrant, idx, x, y } live during drag
  const draggedRef = useRef(false)       // true once a drag actually moved
  const dragStartRef = useRef(null)      // {x,y} fraction where the press began

  const pointToFraction = (e) => {
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  useEffect(() => {
    const update = () => {
      if (imgRef.current) {
        setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [photo])

  if (!photo) return null

  // Aggregate all hits from all quadrants into a flat list (for rendering convenience)
  const allHits = []
  for (const q of QUADRANT_NAMES) {
    const qData = scoring?.quadrantes?.[q]
    if (!qData) continue
    qData.hits.forEach((h, idx) => {
      allHits.push({ ...h, quadrant: q, idx })
    })
  }

  // Edit hits while PRESERVING the per-quadrant calibration measured at detection.
  // rescoreScoring reuses the stored bull centers, ring radii and image aspect, so
  // manual edits stay as accurate as the original scoring.
  const editAndRescore = (mutate) => {
    const next = { ...scoring, quadrantes: {} }
    for (const q of QUADRANT_NAMES) {
      const qd = scoring?.quadrantes?.[q]
      next.quadrantes[q] = qd
        ? { ...qd, hits: [...(qd.hits || [])] }
        : { hits: [] }
    }
    mutate(next)
    onScoringChange?.(rescoreScoring(next))
  }

  const handleImageClick = (e) => {
    if (!editable) return
    if (!imgRef.current) return
    // A marker drag ends with a pointerup; ignore the click the browser may fire after.
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

  // Drag a marker onto the real hole. Commit (and rescore) only on release.
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
    if (start && (Math.abs(x - start.x) > 0.008 || Math.abs(y - start.y) > 0.008)) {
      draggedRef.current = true
    }
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
      // keep draggedRef true so the trailing image click is ignored, then clear it
      setTimeout(() => { draggedRef.current = false }, 0)
    } else {
      // No movement: treat as a tap to remove.
      removeHit(quadrant, idx)
    }
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
          onLoad={() => {
            if (imgRef.current) {
              setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
            }
          }}
          style={editable ? { cursor: 'crosshair' } : {}}
        />

        {imgSize.w > 0 && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
            preserveAspectRatio="none"
          >
            {/* Quadrant dividers */}
            <line x1={imgSize.w / 2} y1={0} x2={imgSize.w / 2} y2={imgSize.h}
              stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 4" />
            <line x1={0} y1={imgSize.h / 2} x2={imgSize.w} y2={imgSize.h / 2}
              stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="4 4" />

            {/* Hit markers */}
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
                  <circle cx={cx} cy={cy} r={big ? 22 : 14}
                    fill="none" stroke={ringColor} strokeWidth={2.5} opacity={0.9} />
                  <circle cx={cx} cy={cy} r={big ? 6 : 4} fill={ringColor} />
                  {(isHovered || isDragging) && (
                    <g>
                      <rect x={cx + 12} y={cy - 24} width={86} height={20} rx={3} fill="rgba(0,0,0,0.9)" />
                      <text x={cx + 55} y={cy - 10} fontSize="11" fill="white" textAnchor="middle"
                        fontFamily="JetBrains Mono, monospace">
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

            {/* Ring guides when editing: draw the measured rings of each quadrant
                so any mismatch with the photo is visible and fixable. */}
            {editable && QUADRANT_NAMES.map((q) => {
              const qData = scoring?.quadrantes?.[q]
              if (!qData || !qData.bull_center) return null
              const cx = qData.bull_center.x * imgSize.w
              const cy = qData.bull_center.y * imgSize.h
              const radii = qData.ring_radii || { r3: qData.ring_3_radius }
              const rings = [radii.r3, radii.r4, radii.r5].filter((r) => r > 0)
              if (rings.length === 0) return null
              return (
                <g key={q}>
                  {rings.map((r, i) => (
                    <circle key={i} cx={cx} cy={cy} r={r * imgSize.w}
                      fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="2 4" />
                  ))}
                  <circle cx={cx} cy={cy} r={3}
                    fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
                </g>
              )
            })}
          </svg>
        )}
      </div>

      {/* Summary + legend */}
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
          Arraste uma marca pra ajustá-la sobre o furo real. Toque numa marca pra removê-la. Toque em qualquer outro lugar da foto pra adicionar um furo. A pontuação recalcula a cada ajuste. Os círculos tracejados mostram os anéis detectados de cada quadrante.
        </div>
      )}
    </div>
  )
}

function labelForZone(zone) {
  return { bull: 'mosca', r5: 'anel 5', r4: 'anel 4', r3: 'anel 3', fora: 'fora' }[zone] || zone
}
