import autoTable from 'jspdf-autotable'
import {
  COLORS, PAGE, CONTENT_W,
  drawChrome, drawTitleBlock, drawSectionHeader,
  drawParagraph, drawBullet, drawMetricCard,
  newDoc, today, buildSubtitle,
} from './utils.js'

export function buildResumo({ sessions, totals, sessionsPlatformCount, club, date: dateOverride }) {
  const doc = newDoc()
  const TOTAL_PAGES = 2
  const date = dateOverride || today()
  const drawHF = (page) => drawChrome(doc, { page, totalPages: TOTAL_PAGES, date, club })

  drawHF(1)

  let y = PAGE.marginTop + 6
  y = drawTitleBlock(doc, y, {
    tag: 'Resumo Executivo',
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

  y = drawSectionHeader(doc, y, 'Leitura da sessão')
  y = drawParagraph(doc, y,
    `Sessão${sessions.length > 1 ? ' multiarma' : ''} ${club?.name ? `no ${club.name}` : ''} ` +
    `com ${sessions.length} treino${sessions.length > 1 ? 's' : ''} cobrindo ` +
    `${sessionsPlatformCount} plataforma${sessionsPlatformCount > 1 ? 's' : ''}. Análise por quadrante ` +
    'e diagnóstico técnico no relatório completo.'
  ) + 3

  y = drawParagraph(doc, y,
    `Resumo numérico: ${totals.disparos} disparos, ${totals.pontos} pontos somados ` +
    `nas zonas de impacto (média de ${totals.ptsTiro.toFixed(2)} pts por tiro).`
  ) + 8

  y = drawSectionHeader(doc, y, 'Resumo das sessões')
  const tableData = sessions.map((s, i) => [
    `S${i + 1}`,
    s.arma,
    s.calibre,
    s.distancia ? `${s.distancia}m` : '—',
    s.disparos,
    s.pontos,
    s.disparos > 0 ? (s.pontos / s.disparos).toFixed(2) : '—',
  ])
  tableData.push([
    'TOTAL', '—', '—', '—',
    totals.disparos, totals.pontos, totals.ptsTiro.toFixed(2),
  ])

  autoTable(doc, {
    startY: y,
    head: [['#', 'Arma', 'Calibre', 'Dist.', 'Disparos', 'Pontos', 'Pts/tiro']],
    body: tableData,
    margin: { left: PAGE.marginX, right: PAGE.marginX },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2 },
    headStyles: {
      fillColor: COLORS.navyRGB,
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
    },
    bodyStyles: { halign: 'center', textColor: COLORS.darkRGB },
    columnStyles: { 1: { halign: 'left' }, 2: { halign: 'left' } },
    didParseCell: (data) => {
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = COLORS.rowBgRGB
      }
    },
  })

  // Diagnostico por sessao, vindo do texto REAL de cada arma (s.resumo/diagnostico).
  // Antes esta secao era texto fixo citando armas que nao estavam na sessao.
  let narrPage = 2
  doc.addPage()
  drawHF(narrPage)
  y = PAGE.marginTop + 6
  y = drawSectionHeader(doc, y, 'Diagnóstico por sessão')

  const ensure = (need) => {
    if (y > PAGE.height - PAGE.marginBottom - need) {
      narrPage += 1
      doc.addPage()
      drawHF(narrPage)
      y = PAGE.marginTop + 6
    }
  }

  sessions.forEach((s, i) => {
    ensure(34)
    const ptsTiro = s.disparos > 0 ? (s.pontos / s.disparos).toFixed(2) : '—'
    y = drawSectionHeader(doc, y, `S${i + 1} · ${s.arma || 'Sem arma'}${s.calibre ? ' · ' + s.calibre : ''}`)
    y = drawParagraph(doc, y,
      `${s.disparos || 0} disparos · ${s.pontos || 0} pontos · ${ptsTiro} pts/tiro` +
      `${s.distancia ? ' · ' + s.distancia + 'm' : ''}.`) + 2
    const texto = (s.resumo || s.diagnostico || '').trim()
    if (texto) {
      ensure(20)
      y = drawParagraph(doc, y, texto) + 5
    } else {
      y = drawParagraph(doc, y,
        'Sem diagnóstico textual gerado para esta sessão. Use "Reanalisar com IA" ' +
        'ou escreva o resumo na própria sessão.') + 5
    }
  })

  return doc
}
