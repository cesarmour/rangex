// Shared PDF utilities for all three documents
import { jsPDF } from 'jspdf'

export const COLORS = {
  navy: '#0A1628',
  navyRGB: [10, 22, 40],
  gold: '#B8923F',
  goldRGB: [184, 146, 63],
  light: '#FAFAF7',
  lightRGB: [250, 250, 247],
  rowBg: '#F4F2EC',
  rowBgRGB: [244, 242, 236],
  gray: '#6B6F76',
  grayRGB: [107, 111, 118],
  dark: '#1A1A1A',
  darkRGB: [26, 26, 26],
  softGray: '#D5D8DC',
  softGrayRGB: [213, 216, 220],
  white: [255, 255, 255],
}

export const PAGE = {
  width: 210,
  height: 297,
  marginX: 18,
  marginTop: 17,
  marginBottom: 15,
}

export const CONTENT_W = PAGE.width - 2 * PAGE.marginX

export function brl(value) {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function drawChrome(doc, { page, totalPages, date, club }) {
  const w = PAGE.width
  const h = PAGE.height
  const barH = 11

  doc.setFillColor(...COLORS.navyRGB)
  doc.rect(0, 0, w, barH, 'F')

  // Brand: STRIKECORE in light weight + SHOOTING ANALYTICS subtitle
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('STRIKECORE', PAGE.marginX, 7.5, { charSpace: 0.5 })
  const brandW = doc.getTextWidth('STRIKECORE') + 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...COLORS.goldRGB)
  doc.text('SHOOTING ANALYTICS', PAGE.marginX + brandW, 7.5, { charSpace: 1.2 })

  // Right side: club name + date (or just date)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const rightText = club?.name
    ? `${club.name.toUpperCase().slice(0, 30)}  ·  ${date}`
    : date
  doc.text(rightText, w - PAGE.marginX, 7.5, { align: 'right' })

  doc.setDrawColor(...COLORS.goldRGB)
  doc.setLineWidth(0.4)
  doc.line(0, barH + 0.3, w, barH + 0.3)

  doc.setTextColor(...COLORS.grayRGB)
  doc.setFontSize(7)
  doc.text('STRIKECORE  ·  DOCUMENTO CONFIDENCIAL', PAGE.marginX, h - 8)
  const pageStr = `PÁGINA ${String(page).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`
  doc.text(pageStr, w - PAGE.marginX, h - 8, { align: 'right' })

  doc.setDrawColor(...COLORS.goldRGB)
  doc.setLineWidth(0.3)
  doc.line(PAGE.marginX, h - 10.5, w - PAGE.marginX, h - 10.5)
}

export function drawTitleBlock(doc, y, { tag, title, subtitle }) {
  doc.setTextColor(...COLORS.goldRGB)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(tag.toUpperCase(), PAGE.marginX, y)
  y += 7

  doc.setTextColor(...COLORS.navyRGB)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(24)
  const titleLines = doc.splitTextToSize(title, CONTENT_W - 50)
  doc.text(titleLines, PAGE.marginX, y)
  y += titleLines.length * 9

  if (subtitle) {
    doc.setTextColor(...COLORS.grayRGB)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    const subLines = doc.splitTextToSize(subtitle, CONTENT_W)
    doc.text(subLines, PAGE.marginX, y)
    y += subLines.length * 4.5
  }

  return y + 4
}

export function drawSectionHeader(doc, y, text) {
  doc.setTextColor(...COLORS.darkRGB)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.text(text, PAGE.marginX, y)
  return y + 5
}

export function drawParagraph(doc, y, text, width = CONTENT_W) {
  doc.setTextColor(...COLORS.darkRGB)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const lines = doc.splitTextToSize(text, width)
  doc.text(lines, PAGE.marginX, y)
  return y + lines.length * 4.5
}

export function drawBullet(doc, y, text, options = {}) {
  const { bold = '', width = CONTENT_W - 5 } = options
  doc.setTextColor(...COLORS.darkRGB)
  doc.setFontSize(9.5)
  const indent = 5
  doc.setFont('helvetica', 'normal')
  doc.text('•', PAGE.marginX, y)

  let xCursor = PAGE.marginX + indent
  if (bold) {
    doc.setFont('helvetica', 'bold')
    doc.text(bold, xCursor, y)
    const boldW = doc.getTextWidth(bold)
    xCursor += boldW + 1.5
    doc.setFont('helvetica', 'normal')
  }
  const available = width - (xCursor - PAGE.marginX - indent) - 5
  const lines = doc.splitTextToSize(text, available)
  doc.text(lines[0], xCursor, y)
  let yCursor = y + 4.5
  for (let i = 1; i < lines.length; i++) {
    doc.text(lines[i], PAGE.marginX + indent, yCursor)
    yCursor += 4.5
  }
  return yCursor + 0.5
}

export function drawMetricCard(doc, x, y, w, h, { label, value }) {
  doc.setFillColor(...COLORS.lightRGB)
  doc.rect(x, y, w, h, 'F')
  doc.setDrawColor(...COLORS.goldRGB)
  doc.setLineWidth(0.5)
  doc.line(x, y, x + w, y)

  doc.setTextColor(...COLORS.navyRGB)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(20)
  doc.text(String(value), x + w / 2, y + h / 2 + 1, { align: 'center' })

  doc.setTextColor(...COLORS.grayRGB)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(label.toUpperCase(), x + w / 2, y + h - 2.5, { align: 'center' })
}

export function newDoc() {
  return new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
}

export function today() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

export function todayLong() {
  const d = new Date()
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`
}

export function buildSubtitle({ sessions, plats, club }) {
  const parts = []
  if (club?.name) parts.push(club.name)
  parts.push(`${sessions} sessões`)
  parts.push(`${plats} plataformas`)
  parts.push(todayLong())
  return parts.join('  ·  ')
}
