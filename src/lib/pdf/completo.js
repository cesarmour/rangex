import autoTable from 'jspdf-autotable'
import {
  COLORS, PAGE, CONTENT_W,
  drawChrome, drawTitleBlock, drawSectionHeader,
  drawParagraph, drawBullet, drawMetricCard,
  newDoc, today, buildSubtitle, brl,
} from './utils.js'

async function loadImageMeta(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = reject
    img.src = dataUrl
  })
}

async function addImageFit(doc, dataUrl, x, y, maxW, maxH) {
  const { width, height } = await loadImageMeta(dataUrl)
  const ratio = Math.min(maxW / width, maxH / height)
  const drawW = width * ratio
  const drawH = height * ratio
  doc.addImage(dataUrl, 'JPEG', x, y, drawW, drawH, undefined, 'FAST')
  return { drawW, drawH }
}

export async function buildCompleto({ sessions, totals, sessionsPlatformCount, precos, club, date: dateOverride }) {
  const doc = newDoc()
  const date = dateOverride || today()
  const TOTAL_PAGES = 3 + sessions.length

  let pageNum = 1
  const draw = () => drawChrome(doc, { page: pageNum, totalPages: TOTAL_PAGES, date, club })

  draw()
  let y = PAGE.marginTop + 6
  y = drawTitleBlock(doc, y, {
    tag: 'Relatório Completo',
    title: 'Relatório de Treino de Tiro',
    subtitle: buildSubtitle({
      sessions: sessions.length,
      plats: sessionsPlatformCount,
      club,
    }),
  })

  const cardW = (CONTENT_W - 4 * 3) / 5
  const cardH = 16
  const cards = [
    { label: 'Disparos totais', value: totals.disparos },
    { label: 'Pontos totais', value: totals.pontos },
    { label: 'Pts / tiro', value: totals.ptsTiro.toFixed(2) },
    { label: 'Sessões', value: sessions.length },
    { label: 'Plataformas', value: sessionsPlatformCount },
  ]
  cards.forEach((c, i) => {
    drawMetricCard(doc, PAGE.marginX + i * (cardW + 3), y, cardW, cardH, c)
  })
  y += cardH + 10

  y = drawSectionHeader(doc, y, 'Sumário executivo')
  y = drawParagraph(doc, y,
    `Sessão${sessions.length > 1 ? ' multiarma' : ''} ${club?.name ? `no ${club.name}` : ''} ` +
    `cobrindo ${sessionsPlatformCount} plataforma${sessionsPlatformCount > 1 ? 's' : ''} em ` +
    `${sessions.length} treino${sessions.length > 1 ? 's' : ''}. Análise por quadrante, ` +
    'diagnóstico técnico e plano de evolução nas páginas seguintes.'
  ) + 8

  y = drawSectionHeader(doc, y, 'Resumo das sessões')
  const tblData = sessions.map((s, i) => [
    `S${i + 1}`, s.arma, s.calibre,
    s.distancia ? `${s.distancia}m` : '—',
    s.disparos, s.pontos,
    s.disparos > 0 ? (s.pontos / s.disparos).toFixed(2) : '—',
  ])
  tblData.push(['TOTAL', '—', '—', '—', totals.disparos, totals.pontos, totals.ptsTiro.toFixed(2)])

  autoTable(doc, {
    startY: y,
    head: [['#', 'Arma', 'Calibre', 'Dist.', 'Disparos', 'Pontos', 'Pts/tiro']],
    body: tblData,
    margin: { left: PAGE.marginX, right: PAGE.marginX },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: COLORS.navyRGB, textColor: 255, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'center', textColor: COLORS.darkRGB },
    columnStyles: { 1: { halign: 'left' }, 2: { halign: 'left' } },
    didParseCell: (data) => {
      if (data.row.index === tblData.length - 1) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = COLORS.rowBgRGB
      }
    },
  })

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]
    doc.addPage()
    pageNum++
    draw()

    y = PAGE.marginTop + 6
    y = drawTitleBlock(doc, y, {
      tag: `Sessão ${i + 1}`,
      title: `${s.arma}  ·  ${s.calibre}`,
    })

    const colLeftW = 75
    const colRightX = PAGE.marginX + colLeftW + 6
    const colRightW = CONTENT_W - colLeftW - 6

    let yLeft = y
    let yRight = y

    if (s.photo) {
      try {
        const { drawH } = await addImageFit(doc, s.photo, PAGE.marginX, yLeft, colLeftW, 110)
        yLeft += drawH + 4
      } catch (e) {
        // skip image
      }
    }

    const fichaRows = [
      ['Arma', s.arma],
      ['Calibre', s.calibre],
      ['Distância', s.distancia ? `${s.distancia} m` : '—'],
      ['Disparos', String(s.disparos)],
      ['Pontos', String(s.pontos)],
      ['Pts/tiro', s.disparos > 0 ? (s.pontos / s.disparos).toFixed(2) : '—'],
    ]

    autoTable(doc, {
      startY: yRight,
      body: fichaRows,
      margin: { left: colRightX, right: PAGE.marginX },
      tableWidth: colRightW,
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: COLORS.lightRGB, cellWidth: 28 },
        1: { cellWidth: colRightW - 28 },
      },
      theme: 'grid',
      tableLineColor: COLORS.softGrayRGB,
      tableLineWidth: 0.1,
    })
    yRight = doc.lastAutoTable.finalY + 6

    doc.setTextColor(...COLORS.darkRGB)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text('Resumo da sessão', colRightX, yRight)
    yRight += 5

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const legacyQuadrantes = ['amarelo', 'verde', 'vermelho', 'azul']
      .map((q) => s.quadrantes?.[q])
      .filter(Boolean)
      .join(' ')
    const resumoTexto = s.resumo || s.diagnostico || legacyQuadrantes || 'Resumo não preenchido.'
    const resumoLines = doc.splitTextToSize(resumoTexto, colRightW)
    for (const line of resumoLines) {
      doc.text(line, colRightX, yRight)
      yRight += 4
    }

    y = Math.max(yLeft, yRight) + 4
  }

  doc.addPage()
  pageNum++
  draw()

  y = PAGE.marginTop + 6
  y = drawTitleBlock(doc, y, {
    tag: 'Consolidado',
    title: 'Análise cruzada da sessão',
  })

  y = drawSectionHeader(doc, y, 'Munição por calibre')

  const agg = {}
  for (const s of sessions) {
    agg[s.calibre] = (agg[s.calibre] || 0) + s.disparos
  }
  const munRows = []
  let totalMun = 0
  for (const [cal, qty] of Object.entries(agg)) {
    const p = precos[cal] ?? 0
    const sub = qty * p
    totalMun += sub
    munRows.push([cal, qty, brl(p), brl(sub)])
  }
  munRows.push(['TOTAL', totals.disparos, '—', brl(totalMun)])

  autoTable(doc, {
    startY: y,
    head: [['Calibre', 'Disparos', 'Custo unit.', 'Subtotal']],
    body: munRows,
    margin: { left: PAGE.marginX, right: PAGE.marginX },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: COLORS.navyRGB, textColor: 255, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'center', textColor: COLORS.darkRGB },
    columnStyles: { 0: { halign: 'left' } },
    didParseCell: (data) => {
      if (data.row.index === munRows.length - 1) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = COLORS.rowBgRGB
      }
    },
  })
  y = doc.lastAutoTable.finalY + 8

  // Diagnostico real por sessao (texto proprio de cada arma), nao texto fixo.
  y = drawSectionHeader(doc, y, 'Diagnóstico por sessão')
  sessions.forEach((s, i) => {
    if (y > PAGE.height - PAGE.marginBottom - 30) { doc.addPage(); pageNum++; draw(); y = PAGE.marginTop + 6 }
    const ptsTiro = s.disparos > 0 ? (s.pontos / s.disparos).toFixed(2) : '—'
    y = drawSectionHeader(doc, y, `S${i + 1} · ${s.arma || 'Sem arma'}${s.calibre ? ' · ' + s.calibre : ''}`)
    y = drawParagraph(doc, y,
      `${s.disparos || 0} disparos · ${s.pontos || 0} pontos · ${ptsTiro} pts/tiro` +
      `${s.distancia ? ' · ' + s.distancia + 'm' : ''}.`) + 2
    const texto = (s.resumo || s.diagnostico || '').trim()
    y = drawParagraph(doc, y, texto || 'Sem diagnóstico textual gerado para esta sessão.') + 5
  })

  doc.addPage()
  pageNum++
  draw()

  y = PAGE.marginTop + 6
  y = drawTitleBlock(doc, y, {
    tag: 'Próximos Passos',
    title: 'Plano de evolução',
  })

  y = drawSectionHeader(doc, y, '1. Recomendações técnicas gerais')
  y = drawParagraph(doc, y,
    'Boas práticas de evolução para aplicar nas próximas idas, com checkpoints mensuráveis. ' +
    'O diagnóstico específico por arma está na seção "Diagnóstico por sessão".') + 4
  y = drawBullet(doc, y, 'drill de bola seca (ball-and-dummy) para neutralizar antecipação de coice.', { bold: 'Controle de flinch:' }) + 1
  y = drawBullet(doc, y, 'verificação do ponto de contato do dedo no gatilho e respiro.', { bold: 'Trigger control:' }) + 1
  y = drawBullet(doc, y, 'confirmar zero/POA em distância controlada antes de medir técnica.', { bold: 'Calibragem:' }) + 6

  y = drawSectionHeader(doc, y, '2. Janelas sugeridas para agendamento')
  const today2 = new Date()
  const addDays = (n) => {
    const d = new Date(today2)
    d.setDate(d.getDate() + n)
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  const sched = [
    ['A', addDays(7) + '  ·  manhã', '2h', 'Técnica: controle de gatilho e flinch'],
    ['B', addDays(14) + '  ·  manhã', '2h30', 'Precisão: confirmação de zero/POA'],
    ['C', addDays(21) + '  ·  manhã', '3h', 'Sessão integrada das plataformas da ida'],
  ]
  autoTable(doc, {
    startY: y,
    head: [['Opção', 'Data sugerida', 'Duração', 'Foco']],
    body: sched,
    margin: { left: PAGE.marginX, right: PAGE.marginX },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: COLORS.navyRGB, textColor: 255, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'left', textColor: COLORS.darkRGB },
    columnStyles: { 0: { halign: 'center', cellWidth: 15 } },
  })

  return doc
}
