import { useRef, useState, useEffect } from 'react'
import { rescoreScoring, QUADRANT_NAMES } from '../lib/scoring.js'
import { calibrationFromFrame, frameToQuad, normalizeFrame, DEFAULT_FRAME, getTarget, bilinear, quadFromCenters } from '../lib/targets.js'

// Overlay dos furos sobre a foto do alvo. Coordenadas em fracao 0..1 da imagem.
//
// Edicao manual (modelo novo):
// - Marca pequena: circulinho fino na cor da zona + etiqueta (A1, V2, R3, B1),
//   sem cobrir o furo.
// - Zoom por quadrante (botoes acima da foto) pra posicionar com precisao.
// - Remocao por SELECAO: toque na marca seleciona, ai aparece o botao
//   "remover" (chip X na foto + barra abaixo). Toque direto NAO apaga mais,
//   o que acabava apagando sem querer.
// - Arrastar continua movendo a marca. Toque em area vazia adiciona furo
//   (se tiver marca selecionada, o primeiro toque so desseleciona).
//
// Props:
//   photo, scoring, editable, onScoringChange
//   frame: quadrilatero {tl,tr,bl,br} (ou retangulo legado) da area de analise
//   targetType, frameEditable, onFrameChange

const HIT_RING_COLORS = {
  bull: '#10b981', r5: '#3b82f6', r4: '#f59e0b', r3: '#ef4444', fora: '#9ca3af', na: '#9ca3af',
}
const CORNER_IDS = ['tl', 'tr', 'bl', 'br']
const QUAD_LETTERS = { amarelo: 'A', verde: 'V', vermelho: 'R', azul: 'B' }

export default function TargetOverlay({
  photo, scoring, editable = false, onScoringChange,
  frame, targetType = 'fc4', frameEditable = false, onFrameChange,
}) {
  const imgRef = useRef(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState(null)
  const [frameDrag, setFrameDrag] = useState(null) // { corner, quad } durante o arraste
  const [centerDrag, setCenterDrag] = useState(null) // arraste do X da mosca: { pid, quad0, centers, start, quad }
  const [selected, setSelected] = useState(null)   // { quadrant, idx } da marca selecionada
  const [zoomKey, setZoomKey] = useState(null)     // null = alvo inteiro, senao chave do padrao
  const draggedRef = useRef(false)
  const dragStartRef = useRef(null)

  const pointToFraction = (e) => {
    // getBoundingClientRect ja reflete o transform do zoom, entao a fracao
    // continua certa com qualquer escala.
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  // Versao SEM prender em 0..1: canto do quadro pode sair da foto (foto sem
  // borda). O pointer capture continua mandando eventos fora da imagem.
  const pointToFractionExt = (e) => {
    const rect = imgRef.current.getBoundingClientRect()
    const EXT = 0.5
    return {
      x: Math.max(-EXT, Math.min(1 + EXT, (e.clientX - rect.left) / rect.width)),
      y: Math.max(-EXT, Math.min(1 + EXT, (e.clientY - rect.top) / rect.height)),
    }
  }

  useEffect(() => {
    const update = () => { if (imgRef.current) setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight }) }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [photo])

  // Scoring mudou (add/move/remove/rescore): qualquer selecao antiga e invalida.
  useEffect(() => { setSelected(null) }, [scoring])

  // Saiu do modo edicao: reseta zoom e selecao.
  useEffect(() => {
    if (!editable) { setZoomKey(null); setSelected(null) }
  }, [editable])

  if (!photo) return null

  const effQuad = frameDrag ? frameDrag.quad
    : centerDrag ? centerDrag.quad
    : frameToQuad(frame || DEFAULT_FRAME)

  const allHits = []
  for (const q of QUADRANT_NAMES) {
    const qData = scoring?.quadrantes?.[q]
    if (!qData) continue
    qData.hits.forEach((h, idx) => { allHits.push({ ...h, quadrant: q, idx }) })
  }

  const hitLabel = (quadrant, idx) => `${QUAD_LETTERS[quadrant] || '?'}${idx + 1}`
  const selHit = selected
    ? allHits.find((h) => h.quadrant === selected.quadrant && h.idx === selected.idx) || null
    : null

  const editAndRescore = (mutate) => {
    const next = { ...scoring, quadrantes: {} }
    for (const q of QUADRANT_NAMES) {
      const qd = scoring?.quadrantes?.[q]
      next.quadrantes[q] = qd ? { ...qd, hits: [...(qd.hits || [])] } : { hits: [] }
    }
    mutate(next)
    onScoringChange?.(rescoreScoring(next)) // trata concentric e count
  }

  const handleImageClick = (e) => {
    if (!editable || !imgRef.current) return
    if (draggedRef.current) { draggedRef.current = false; return }
    // Com marca selecionada, o toque fora so desseleciona (nao adiciona furo
    // sem querer enquanto a pessoa esta mexendo numa marca).
    if (selected) { setSelected(null); return }
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

  const removeSelected = () => {
    if (!selected) return
    removeHit(selected.quadrant, selected.idx)
  }

  // ---- arraste de marca ----
  const onMarkerDown = (e, quadrant, idx, hit) => {
    if (!editable) return
    e.stopPropagation()
    try { e.target.setPointerCapture(e.pointerId) } catch {}
    draggedRef.current = false
    dragStartRef.current = { x: hit.x, y: hit.y }
    setDrag({ quadrant, idx, x: hit.x, y: hit.y })
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
      // Toque sem arrastar: seleciona/desseleciona (NAO apaga direto).
      setSelected((prev) =>
        prev && prev.quadrant === quadrant && prev.idx === idx ? null : { quadrant, idx })
    }
  }
  // iOS pode roubar o gesto (pointercancel): descarta o arraste sem commit,
  // senao o estado fica pendurado e o proximo toque se comporta errado.
  const onMarkerCancel = () => {
    setDrag(null)
    setTimeout(() => { draggedRef.current = false }, 0)
  }

  // ---- arraste dos cantos do quadro (cada canto e LIVRE) ----
  const onCornerDown = (e, corner) => {
    e.stopPropagation()
    try { e.target.setPointerCapture(e.pointerId) } catch {}
    draggedRef.current = true
    const q = effQuad
    setFrameDrag({ corner, quad: { tl: { ...q.tl }, tr: { ...q.tr }, bl: { ...q.bl }, br: { ...q.br } } })
  }
  const onCornerMove = (e) => {
    if (!frameDrag) return
    e.stopPropagation()
    const { x, y } = pointToFractionExt(e)
    setFrameDrag((d) => (d ? { ...d, quad: { ...d.quad, [d.corner]: { x, y } } } : d))
  }
  const onCornerUp = (e) => {
    e.stopPropagation()
    try { e.target.releasePointerCapture(e.pointerId) } catch {}
    const committed = frameDrag ? normalizeFrame(frameDrag.quad) : null
    setFrameDrag(null)
    if (committed) onFrameChange?.(committed)
    setTimeout(() => { draggedRef.current = false }, 0)
  }

  // ---- arraste do CENTRO (X da mosca) ----
  // Arrasta a mosca direto e o quadro se resolve sozinho (inversao do bilinear
  // pra 4 padroes, translacao pra 1). E o caminho certo quando a foto nao tem
  // borda: o canto correspondente cai fora da imagem e tudo bem.
  const onCenterDown = (e, pid) => {
    e.stopPropagation()
    try { e.target.setPointerCapture(e.pointerId) } catch {}
    draggedRef.current = true
    const q = effQuad
    const quad0 = { tl: { ...q.tl }, tr: { ...q.tr }, bl: { ...q.bl }, br: { ...q.br } }
    const centers = {}
    for (const p of target.patterns) centers[p.id] = { ...bilinear(quad0, p.u, p.v) }
    setCenterDrag({ pid, quad0, centers, start: { ...centers[pid] }, quad: quad0 })
    setSelected(null)
  }
  const onCenterMove = (e) => {
    if (!centerDrag) return
    e.stopPropagation()
    const pos = pointToFraction(e)
    setCenterDrag((d) => {
      if (!d) return d
      const centers = { ...d.centers, [d.pid]: pos }
      let quad
      if (target.patterns.length === 4) {
        quad = quadFromCenters(target.patterns, centers) || d.quad
      } else {
        const dx = pos.x - d.start.x, dy = pos.y - d.start.y
        const mv = (p) => ({ x: p.x + dx, y: p.y + dy })
        quad = { tl: mv(d.quad0.tl), tr: mv(d.quad0.tr), bl: mv(d.quad0.bl), br: mv(d.quad0.br) }
      }
      return { ...d, centers, quad }
    })
  }
  const onCenterUp = (e) => {
    e.stopPropagation()
    try { e.target.releasePointerCapture(e.pointerId) } catch {}
    const committed = centerDrag ? normalizeFrame(centerDrag.quad) : null
    setCenterDrag(null)
    if (committed) onFrameChange?.(committed)
    setTimeout(() => { draggedRef.current = false }, 0)
  }

  // preview ao vivo a partir do quadro efetivo
  const previewCal = calibrationFromFrame(effQuad, targetType).quadrants
  const target = getTarget(targetType)
  // Com 4 padroes, os 4 centros determinam o quadro inteiro (8 dof = 8 dof):
  // canto arrastavel vira redundante e so causa arraste acidental (o canto
  // pinado na borda fica onde o dedo encosta). Entao no fc4 so os X mandam.
  const centersDetermineQuad = target.patterns.length === 4
  const seen = new Set()
  const previewPatterns = QUADRANT_NAMES.map((q) => {
    const c = previewCal[q]
    const key = `${c.bull_center.x.toFixed(4)},${c.bull_center.y.toFixed(4)}`
    if (seen.has(key)) return null
    seen.add(key)
    return { q, ...c }
  }).filter(Boolean)

  // ---- zoom por quadrante ----
  // Transform CSS no bloco foto+svg. Como o transform e afim, pointToFraction
  // e os arrastes continuam funcionando sem conversao extra.
  const ZOOM_SCALE = previewPatterns.length > 1 ? 2.2 : 2
  const zoomPattern = zoomKey ? previewPatterns.find((p) => p.q === zoomKey) : null
  let zoomStyle = { transform: 'none', transformOrigin: '0 0', transition: 'transform 0.25s ease' }
  if (zoomPattern && imgSize.w > 0) {
    const s = ZOOM_SCALE
    const cx = zoomPattern.bull_center.x, cy = zoomPattern.bull_center.y
    let tx = imgSize.w * (0.5 - s * cx)
    let ty = imgSize.h * (0.5 - s * cy)
    tx = Math.min(0, Math.max(imgSize.w * (1 - s), tx))
    ty = Math.min(0, Math.max(imgSize.h * (1 - s), ty))
    zoomStyle = { transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: '0 0', transition: 'transform 0.25s ease' }
  }

  const P = (pt) => ({ x: pt.x * imgSize.w, y: pt.y * imgSize.h })
  const tl = P(effQuad.tl), tr = P(effQuad.tr), bl = P(effQuad.bl), br = P(effQuad.br)
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

  return (
    <div className="space-y-2">
      {editable && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">zoom</span>
          <button
            type="button"
            onClick={() => setZoomKey(null)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${
              !zoomKey ? 'bg-navy text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            alvo inteiro
          </button>
          {previewPatterns.map((p) => (
            <button
              key={p.q}
              type="button"
              onClick={() => { setZoomKey(p.q); setSelected(null) }}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${
                zoomKey === p.q ? 'bg-navy text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {previewPatterns.length > 1 ? p.q : 'centro'}
            </button>
          ))}
        </div>
      )}

      <div className="relative w-full overflow-hidden rounded-md select-none" style={{ touchAction: 'manipulation' }}>
        <div className="relative" style={zoomStyle}>
          <img
            ref={imgRef}
            src={photo}
            alt="Alvo"
            className="w-full block"
            onClick={handleImageClick}
            onLoad={() => { if (imgRef.current) setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight }) }}
            style={editable ? { cursor: 'crosshair' } : {}}
          />

          {imgSize.w > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${imgSize.w} ${imgSize.h}`} preserveAspectRatio="none">

              {frameEditable && (
                <g>
                  <polygon
                    points={`${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`}
                    fill="none" stroke="#facc15" strokeWidth={2} strokeDasharray="6 4" opacity={0.95} />
                  {target.patterns.length > 1 && (
                    <g stroke="rgba(250,204,21,0.5)" strokeWidth={1} strokeDasharray="4 4">
                      <line x1={mid(tl, tr).x} y1={mid(tl, tr).y} x2={mid(bl, br).x} y2={mid(bl, br).y} />
                      <line x1={mid(tl, bl).x} y1={mid(tl, bl).y} x2={mid(tr, br).x} y2={mid(tr, br).y} />
                    </g>
                  )}
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

              {allHits.map((hit, i) => {
                const isDragging = drag && drag.quadrant === hit.quadrant && drag.idx === hit.idx
                const isSelected = selected && selected.quadrant === hit.quadrant && selected.idx === hit.idx
                const hx = isDragging ? drag.x : hit.x
                const hy = isDragging ? drag.y : hit.y
                const cx = hx * imgSize.w, cy = hy * imgSize.h
                const ringColor = HIT_RING_COLORS[hit.zone] || '#9ca3af'
                const label = hitLabel(hit.quadrant, hit.idx)
                const active = isSelected || isDragging
                return (
                  <g key={i}>
                    {/* marca pequena: circulinho fino + etiqueta, sem cobrir o furo */}
                    <circle cx={cx} cy={cy} r={active ? 9 : 7} fill="none"
                      stroke={ringColor} strokeWidth={active ? 2.4 : 1.7} opacity={0.95} />
                    {active && (
                      <circle cx={cx} cy={cy} r={14} fill="none" stroke={ringColor}
                        strokeWidth={1} strokeDasharray="3 3" opacity={0.85} />
                    )}
                    <text x={cx + 10} y={cy + 3} fontSize="9" fontWeight="700" fill={ringColor}
                      stroke="rgba(255,255,255,0.85)" strokeWidth={2.5} paintOrder="stroke"
                      fontFamily="JetBrains Mono, monospace">
                      {label}
                    </text>
                    {editable && (
                      <circle cx={cx} cy={cy} r={16} fill="transparent"
                        style={{ pointerEvents: 'auto', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                        onPointerDown={(e) => onMarkerDown(e, hit.quadrant, hit.idx, hit)}
                        onPointerMove={onMarkerMove}
                        onPointerUp={(e) => onMarkerUp(e, hit.quadrant, hit.idx)}
                        onPointerCancel={onMarkerCancel} />
                    )}
                    {editable && isSelected && !isDragging && (
                      <g
                        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeSelected() }}
                      >
                        <circle cx={cx + 20} cy={cy - 20} r={14} fill="transparent" />
                        <circle cx={cx + 20} cy={cy - 20} r={9} fill="#dc2626" stroke="white" strokeWidth={1.5} />
                        <line x1={cx + 16.5} y1={cy - 23.5} x2={cx + 23.5} y2={cy - 16.5} stroke="white" strokeWidth={1.8} />
                        <line x1={cx + 23.5} y1={cy - 23.5} x2={cx + 16.5} y2={cy - 16.5} stroke="white" strokeWidth={1.8} />
                      </g>
                    )}
                  </g>
                )
              })}

              {frameEditable && !centersDetermineQuad && CORNER_IDS.map((id) => {
                // Canto fora da foto: o handle fica PINADO na borda visivel
                // (meio transparente) e continua arrastavel.
                const c = P(effQuad[id])
                const dx = Math.max(10, Math.min(imgSize.w - 10, c.x))
                const dy = Math.max(10, Math.min(imgSize.h - 10, c.y))
                const pinned = dx !== c.x || dy !== c.y
                return (
                  <g key={id} opacity={pinned ? 0.55 : 1}>
                    <circle cx={dx} cy={dy} r={7} fill="#facc15" stroke="#1f2937" strokeWidth={1.5}
                      strokeDasharray={pinned ? '2 2' : 'none'} />
                    <circle cx={dx} cy={dy} r={24} fill="transparent"
                      style={{ pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
                      onPointerDown={(e) => onCornerDown(e, id)}
                      onPointerMove={onCornerMove}
                      onPointerUp={onCornerUp}
                      onPointerCancel={onCornerUp} />
                  </g>
                )
              })}

              {frameEditable && previewPatterns.map((p) => {
                // X ciano da mosca (modelo da foto): arrasta o centro direto e o
                // quadro acompanha, mesmo com o alvo cortado na foto.
                const c = P(p.bull_center)
                return (
                  <g key={`ct-${p.q}`}>
                    <line x1={c.x - 7} y1={c.y - 7} x2={c.x + 7} y2={c.y + 7} stroke="#083344" strokeWidth={5} strokeLinecap="round" opacity={0.5} />
                    <line x1={c.x + 7} y1={c.y - 7} x2={c.x - 7} y2={c.y + 7} stroke="#083344" strokeWidth={5} strokeLinecap="round" opacity={0.5} />
                    <line x1={c.x - 7} y1={c.y - 7} x2={c.x + 7} y2={c.y + 7} stroke="#22d3ee" strokeWidth={2.5} strokeLinecap="round" />
                    <line x1={c.x + 7} y1={c.y - 7} x2={c.x - 7} y2={c.y + 7} stroke="#22d3ee" strokeWidth={2.5} strokeLinecap="round" />
                    <circle cx={c.x} cy={c.y} r={16} fill="transparent"
                      style={{ pointerEvents: 'auto', cursor: 'move', touchAction: 'none' }}
                      onPointerDown={(e) => onCenterDown(e, p.q)}
                      onPointerMove={onCenterMove}
                      onPointerUp={onCenterUp}
                      onPointerCancel={onCenterUp} />
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </div>

      {editable && selHit && (
        <div className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded-md px-3 py-2">
          <span className="text-xs text-stone-700 font-semibold">
            {hitLabel(selHit.quadrant, selHit.idx)} · {labelForZone(selHit.zone)}
            {selHit.zone === 'na' ? '' : ` · ${selHit.points}pt`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 transition"
            >
              cancelar
            </button>
            <button
              type="button"
              onClick={removeSelected}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 transition"
            >
              remover
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-stone-500 px-1">
        <span className="font-semibold text-stone-700">
          {scoring?.total_disparos || 0} disparos{scoring?.mode === 'count' ? '' : ` · ${scoring?.total_pontos || 0} pts`}
        </span>
        {scoring?.mode === 'count' ? (
          <span className="text-stone-400">contagem (sem zonas)</span>
        ) : (
          <>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.bull }} />mosca/5 (5)</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.r4 }} />anel 4</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.r3 }} />anel 3</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: HIT_RING_COLORS.fora }} />fora</span>
          </>
        )}
      </div>

      {editable && (
        <div className="text-[10px] text-stone-500 px-1 leading-relaxed">
          {frameEditable
            ? (centersDetermineQuad
                ? 'Use o zoom pra trabalhar num quadrante. Toque numa marca pra selecionar e remover, arraste pra ajustar, toque em área vazia pra adicionar. Pra alinhar o quadro, arraste o X ciano de cada mosca até o centro impresso: cada X é independente e o quadro se resolve sozinho, mesmo com o alvo cortado na foto. Depois "redetectar no quadro" se quiser.'
                : 'Use o zoom pra trabalhar no alvo. Toque numa marca pra selecionar e remover, arraste pra ajustar, toque em área vazia pra adicionar. Arraste o X ciano pra posicionar o centro e os cantos amarelos pra dar o tamanho/forma do quadro (o canto pode sair da foto, fica pinado na borda). Depois "redetectar no quadro" se quiser.')
            : 'Use o zoom pra trabalhar num quadrante. Toque numa marca pra selecionar e remover. Arraste pra ajustar. Toque em área vazia pra adicionar. A pontuação recalcula a cada ajuste.'}
        </div>
      )}
    </div>
  )
}

function labelForZone(zone) {
  return { bull: 'mosca', r5: 'anel 5', r4: 'anel 4', r3: 'anel 3', fora: 'fora', na: 'furo' }[zone] || zone
}
