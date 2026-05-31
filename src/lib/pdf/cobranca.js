import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import {
  COLORS, PAGE, CONTENT_W,
  drawChrome, drawTitleBlock, drawSectionHeader,
  newDoc, today, todayLong, brl,
} from './utils.js'
import { buildPixPayload } from '../pix.js'

export async function buildCobranca({ sessions, totals, precos, pix, club }) {
  const doc = newDoc()
  const date = today()
  const TOTAL_PAGES = 1

  drawChrome(doc, { page: 1, totalPages: TOTAL_PAGES, date, club })

  let y = PAGE.marginTop + 6
  const subtitleParts = [`Sessão de ${todayLong()}`]
  if (club?.name) subtitleParts.push(club.name)
  y = drawTitleBlock(doc, y, {
    tag: 'Cobrança',
    title: 'Treino de Tiro',
    subtitle: subtitleParts.join('  ·  '),
  })

  y = drawSectionHeader(doc, y, 'Disparos por sessão')
  const sessRows = sessions.map((s, i) => [`S${i + 1}`, s.arma, s.calibre, s.disparos])
  sessRows.push(['TOTAL', '—', '—', totals.disparos])

  autoTable(doc, {
    startY: y,
    head: [['Sessão', 'Arma', 'Calibre', 'Disparos']],
    body: sessRows,
    margin: { left: PAGE.marginX, right: PAGE.marginX },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: COLORS.navyRGB, textColor: 255, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'center', textColor: COLORS.darkRGB },
    columnStyles: { 1: { halign: 'left' }, 2: { halign: 'left' } },
    didParseCell: (data) => {
      if (data.row.index === sessRows.length - 1) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = COLORS.rowBgRGB
      }
    },
  })
  y = doc.lastAutoTable.finalY + 8

  y = drawSectionHeader(doc, y, 'Valor sugerido por calibre')
  const agg = {}
  for (const s of sessions) agg[s.calibre] = (agg[s.calibre] || 0) + s.disparos

  let totalMun = 0
  const cobRows = []
  for (const [cal, qty] of Object.entries(agg)) {
    const p = precos[cal] ?? 0
    const sub = qty * p
    totalMun += sub
    cobRows.push([cal, qty, brl(p), brl(sub)])
  }
  const totalPagar = totalMun
  cobRows.push(['TOTAL A PAGAR', '—', '—', brl(totalPagar)])

  autoTable(doc, {
    startY: y,
    head: [['Calibre', 'Quantidade', 'Preço unit.', 'Subtotal']],
    body: cobRows,
    margin: { left: PAGE.marginX, right: PAGE.marginX },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: COLORS.navyRGB, textColor: 255, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'center', textColor: COLORS.darkRGB },
    columnStyles: { 0: { halign: 'left' } },
    didParseCell: (data) => {
      const last = cobRows.length - 1
      if (data.row.index === last) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = COLORS.navyRGB
        data.cell.styles.textColor = 255
        data.cell.styles.fontSize = 10.5
      }
    },
  })
  y = doc.lastAutoTable.finalY + 12

  const pixBoxH = 56
  doc.setFillColor(...COLORS.lightRGB)
  doc.rect(PAGE.marginX, y, CONTENT_W, pixBoxH, 'F')
  doc.setDrawColor(...COLORS.goldRGB)
  doc.setLineWidth(0.6)
  doc.line(PAGE.marginX, y, PAGE.marginX + CONTENT_W, y)
  doc.setLineWidth(0.3)
  doc.line(PAGE.marginX, y + 0.6, PAGE.marginX + CONTENT_W, y + 0.6)

  const payload = buildPixPayload({
    key: pix.key,
    amount: totalPagar,
    merchant: pix.merchant,
    city: pix.city,
  })
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: COLORS.navy, light: '#FFFFFF' },
    width: 400,
  })

  const padding = 10
  let yPix = y + padding
  doc.setTextColor(...COLORS.goldRGB)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('PAGAMENTO VIA PIX', PAGE.marginX + padding, yPix)
  yPix += 7

  doc.setTextColor(...COLORS.navyRGB)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(28)
  doc.text(brl(totalPagar), PAGE.marginX + padding, yPix + 6)
  yPix += 13

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLORS.darkRGB)
  doc.text('Chave PIX (aleatória):', PAGE.marginX + padding, yPix)
  yPix += 4
  doc.setFont('courier', 'normal')
  doc.setFontSize(8)
  doc.text(pix.key, PAGE.marginX + padding, yPix)
  yPix += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`Beneficiário: ${pix.merchant}`, PAGE.marginX + padding, yPix)
  yPix += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...COLORS.grayRGB)
  doc.text('Escaneie o QR Code com o app do seu banco para pagar.',
    PAGE.marginX + padding, yPix)

  const qrSize = 42
  const qrX = PAGE.marginX + CONTENT_W - qrSize - padding
  const qrY = y + (pixBoxH - qrSize) / 2
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)

  return doc
}
