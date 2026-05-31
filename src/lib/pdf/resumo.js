import autoTable from 'jspdf-autotable'
import {
  COLORS, PAGE, CONTENT_W,
  drawChrome, drawTitleBlock, drawSectionHeader,
  drawParagraph, drawBullet, drawMetricCard,
  newDoc, today, buildSubtitle,
} from './utils.js'

export function buildResumo({ sessions, totals, sessionsPlatformCount, club }) {
  const doc = newDoc()
  const TOTAL_PAGES = 2
  const date = today()
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

  doc.addPage()
  drawHF(2)

  y = PAGE.marginTop + 6
  y = drawSectionHeader(doc, y, 'Pontos fortes')
  y = drawBullet(doc, y, 'Sessão executada com regularidade técnica e estrutura analítica clara por plataforma.') + 1
  y = drawBullet(doc, y, 'Diagnóstico cruzado entre pistola e rifle permite isolar variáveis de técnica vs. mecânica.') + 1
  y = drawBullet(doc, y, 'Resiliência: múltiplas sessões em uma única ida, mantendo padrão de avaliação.') + 4

  y = drawSectionHeader(doc, y, 'Pontos a corrigir')
  y = drawBullet(doc, y, 'padrão baixo-esquerda no Shield 9mm indica antecipação de coice e pressão lateral do gatilho.', { bold: 'Antecipação de coice no Shield 9mm:' }) + 1
  y = drawBullet(doc, y, 'viés alto consistente em 5.56 e .22 LR indica calibragem de zero, não técnica.', { bold: 'Zero / POA dos rifles:' }) + 1
  y = drawBullet(doc, y, 'azul costuma vir como último quadrante. Indicador de fadiga ou pressa.', { bold: 'Dispersão final no azul:' }) + 4

  y = drawSectionHeader(doc, y, 'Próximos passos')
  y = drawBullet(doc, y, 'Sessão de ajuste técnico com Capitão Cavalheiro: flinch no Shield + zero dos rifles.') + 1
  y = drawBullet(doc, y, 'Implementar drill de bola seca (ball and dummy) em todas as sessões de pistola.') + 1
  y = drawBullet(doc, y, 'Confirmar zero do Zion-15 e Wildcat em distância controlada (25m e 50m).') + 1
  y = drawBullet(doc, y, 'Manter cadência semanal com plano estruturado por plataforma.')

  return doc
}
