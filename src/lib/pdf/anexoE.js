// Declaracao de Habitualidade - Anexo E (Portaria 260-COLOG/2025).
// PDF consolidado por atirador, em papel timbrado da entidade, pronto pra
// assinatura digital ICP-Brasil/gov.br do responsavel legal (a assinatura
// criptografica e aplicada FORA do app, sobre este PDF).
import autoTableImport from 'jspdf-autotable'
import { jsPDF } from 'jspdf'

// interop CJS/ESM: no browser (Vite) vem a funcao direto; no Node vem {default}
const autoTable = typeof autoTableImport === 'function' ? autoTableImport : autoTableImport.default
import { GRUPO_LABELS } from '../habitualidade.js'

const M = 14
const W = 210

function fmtDH(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function fmtD(iso) {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
}

function header(doc, entidade, livro) {
  doc.setFillColor(10, 22, 40)
  doc.rect(0, 0, W, 24, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text((entidade?.nome || '').toUpperCase().slice(0, 80), M, 9)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(`CNPJ ${entidade?.cnpj || '—'}  ·  ${entidade?.endereco || ''}`.slice(0, 120), M, 14.5)
  doc.setTextColor(184, 146, 63)
  doc.text(`Registro Eletrônico de Habitualidade · Livro/Sistema: ${livro}`, M, 20)
}

function sectionTitle(doc, y, text) {
  doc.setFillColor(244, 242, 236)
  doc.rect(M, y, W - 2 * M, 7, 'F')
  doc.setTextColor(10, 22, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(text, M + 2, y + 4.8)
  return y + 9
}

function kvLine(doc, y, pairs) {
  doc.setFontSize(8)
  let x = M + 2
  for (const [k, v] of pairs) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(107, 111, 118)
    doc.text(`${k}: `, x, y)
    x += doc.getTextWidth(`${k}: `)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(26, 26, 26)
    const vs = String(v || '—')
    doc.text(vs, x, y)
    x += doc.getTextWidth(vs) + 6
  }
  return y + 5
}

// sessions: registros do periodo (ja filtrados), config: { entidade, responsavel, livro_sistema }
// atirador: { nome, cpf, cr, crData, nivel }
export function buildAnexoE({ sessions, atirador, config, periodo }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const entidade = config?.entidade || {}
  const responsavel = config?.responsavel || {}
  const livro = config?.livro_sistema || 'StrikeCore'

  header(doc, entidade, livro)

  let y = 31
  doc.setTextColor(10, 22, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('DECLARAÇÃO DE HABITUALIDADE — ANEXO E', W / 2, y, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(107, 111, 118)
  y += 5
  doc.text(`Portaria nº 166-COLOG/2023, alterada pela Portaria nº 260-COLOG/2025 · Período: ${fmtD(periodo.inicio)} a ${fmtD(periodo.fim)}`, W / 2, y, { align: 'center' })
  y += 7

  // Entidade declarante
  y = sectionTitle(doc, y, 'ENTIDADE DE TIRO DECLARANTE')
  y = kvLine(doc, y, [['Nome', entidade.nome], ['CNPJ', entidade.cnpj]])
  y = kvLine(doc, y, [['Certificado de Registro', entidade.cr_numero || '—'], ['Data', fmtD(entidade.cr_data)]])
  y = kvLine(doc, y, [['Endereço', entidade.endereco]])
  y += 2

  // Atirador
  y = sectionTitle(doc, y, 'ATIRADOR DESPORTIVO')
  y = kvLine(doc, y, [['Nome', atirador.nome], ['CPF', atirador.cpf]])
  y = kvLine(doc, y, [['Certificado de Registro (CR)', atirador.cr], ['Data', fmtD(atirador.crData)], ['Nível', atirador.nivel === 'alto_rendimento' ? 'Alto Rendimento' : `Nível ${atirador.nivel}`]])
  y += 2

  // Blocos: uso permitido e uso restrito, agrupados por grupo/inciso
  const blocos = [
    { titulo: 'HABITUALIDADE — ARMAS DE USO PERMITIDO (Art. 11)', uso: 'permitido' },
    { titulo: 'HABITUALIDADE — ARMAS DE USO RESTRITO (Art. 12)', uso: 'restrito' },
  ]

  for (const bloco of blocos) {
    const doBloco = sessions.filter((s) => s.uso === bloco.uso)
    if (doBloco.length === 0) continue

    if (y > 230) { doc.addPage(); header(doc, entidade, livro); y = 31 }
    y = sectionTitle(doc, y, bloco.titulo)

    const grupos = [...new Set(doBloco.map((s) => s.grupo_no_evento))].sort()
    for (const g of grupos) {
      const doGrupo = doBloco
        .filter((s) => s.grupo_no_evento === g)
        .sort((a, b) => new Date(a.data_hora_evento) - new Date(b.data_hora_evento))

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(184, 146, 63)
      doc.text(GRUPO_LABELS[g] || `Grupo ${g}`, M + 2, y + 3)
      y += 5

      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        styles: { fontSize: 7, cellPadding: 1.6, textColor: [26, 26, 26] },
        headStyles: { fillColor: [10, 22, 40], textColor: [255, 255, 255], fontSize: 6.5 },
        alternateRowStyles: { fillColor: [248, 247, 243] },
        head: [['Ord.', 'Data-hora', 'Arma', 'SIGMA (1)', 'Munição (2)', 'Evento / Atividade', 'Nº Registro', 'Lançamento']],
        body: doGrupo.map((s, i) => [
          String(i + 1),
          fmtDH(s.data_hora_evento),
          `${s.arma_snapshot?.marca || ''} ${s.arma_snapshot?.modelo || ''} ${s.arma_snapshot?.calibre || ''}`.trim(),
          s.arma_snapshot?.sigma || '—',
          `${s.qtd_municao} un ${s.municao_calibre}`,
          `${s.tipo_evento === 'competicao' ? `Competição (${s.nivel_competicao})` : 'Treinamento'} — ${s.atividade_desc}`,
          `${s.numero_registro} / fl. ${s.folha}`,
          fmtD(s.data_lancamento),
        ]),
      })
      y = doc.lastAutoTable.finalY + 4
      if (y > 240) { doc.addPage(); header(doc, entidade, livro); y = 31 }
    }
  }

  if (sessions.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(107, 111, 118)
    doc.text('Sem registros de habitualidade no período.', M + 2, y + 4)
    y += 12
  }

  // Observacoes fixas do rodape (sec. 5.6)
  if (y > 215) { doc.addPage(); header(doc, entidade, livro); y = 31 }
  y = sectionTitle(doc, y, 'OBSERVAÇÕES')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  doc.setTextColor(107, 111, 118)
  const obs = [
    '(1) SIGMA: número da arma no Sistema de Gerenciamento Militar de Armas.',
    '(2) Quantidade de munições utilizadas na atividade.',
    '(3) A temporalidade dos registros de habitualidade é permanente.',
    '(4) Registro Eletrônico adotado pela Entidade de Tiro (Livro/Sistema: ' + livro + ').',
  ]
  for (const o of obs) { doc.text(o, M + 2, y); y += 3.6 }
  y += 8

  // Assinatura do responsavel legal
  if (y > 245) { doc.addPage(); header(doc, entidade, livro); y = 41 }
  doc.setDrawColor(150, 150, 150)
  doc.line(W / 2 - 45, y + 14, W / 2 + 45, y + 14)
  doc.setFontSize(8.5)
  doc.setTextColor(26, 26, 26)
  doc.setFont('helvetica', 'bold')
  doc.text(responsavel.nome || '—', W / 2, y + 19, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(107, 111, 118)
  doc.text(`${responsavel.cargo || 'Responsável Legal'} — ${entidade.nome || ''}`.slice(0, 90), W / 2, y + 23.5, { align: 'center' })
  doc.text('Documento destinado a assinatura digital ICP-Brasil ou gov.br do responsável legal.', W / 2, y + 28, { align: 'center' })

  return doc
}
