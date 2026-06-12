// Declaracao de Habitualidade - Anexo E, no layout do modelo oficial usado
// pela entidade (tabelas em grade P&B, blocos por calibre dentro de uso
// restrito/permitido, rodape "REGISTRO DE HABITUALIDADE" por bloco e fecho
// com cidade/data e assinatura do responsavel legal).
// O PDF sai pronto pra assinatura digital ICP-Brasil/gov.br aplicada fora do app.
import autoTableImport from 'jspdf-autotable'
import { jsPDF } from 'jspdf'

// interop CJS/ESM: no browser (Vite) vem a funcao direto; no Node vem {default}
const autoTable = typeof autoTableImport === 'function' ? autoTableImport : autoTableImport.default

const M = 12
const W = 210
const H = 297

function fmtDH(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function fmtD(iso) {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : ''
}

// 'Art.11,I' -> 'INCISO I, ART. 11, DEC 11.615/2023'
function ordemTexto(inciso) {
  const m = /Art\.?\s*(\d+)\s*,\s*(\w+)/i.exec(inciso || '')
  if (!m) return 'ARMA REPRESENTATIVA - DEC 11.615/2023'
  return `ARMA REPRESENTATIVA DO TIPO PREVISTO NO INCISO ${m[2].toUpperCase()}, ART. ${m[1]}, DEC 11.615/2023`
}

function eventoTexto(s) {
  const mod = (s.atividade_desc || 'TREINO').toUpperCase()
  if (s.tipo_evento === 'competicao') {
    return `COMPETIÇÃO ${(s.nivel_competicao || '').toUpperCase()} - MODALIDADE: ${mod}`
  }
  return `TREINO - MODALIDADE: ${mod}`
}

const GRID = {
  theme: 'grid',
  styles: {
    font: 'helvetica', fontSize: 7.2, cellPadding: 1.4,
    lineColor: [0, 0, 0], lineWidth: 0.25, textColor: [0, 0, 0],
    valign: 'middle',
  },
  margin: { left: M, right: M },
}

function infoTable(doc, startY, rows) {
  autoTable(doc, {
    ...GRID,
    startY,
    body: rows,
    styles: { ...GRID.styles, fontSize: 7.6 },
    didParseCell: (data) => {
      // negrito no rotulo "Campo:" dentro da celula
      data.cell.styles.fontStyle = 'normal'
    },
  })
  return doc.lastAutoTable.finalY
}

function sectionCaption(doc, y, text) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(0, 0, 0)
  doc.text(text, W / 2, y, { align: 'center' })
  return y + 2.5
}

function ensureSpace(doc, y, needed) {
  if (y + needed > H - 18) {
    doc.addPage()
    return 14
  }
  return y
}

// sessions (formato snake do banco), atirador { nome, cpf, cr, crData, filiacaoNumero, filiacaoData, endereco }
// config { entidade { nome, cnpj, cr_numero, cr_data, endereco, cidade_uf }, responsavel { nome, cargo }, livro_sistema }
export function buildAnexoE({ sessions, atirador, config, periodo }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const entidade = config?.entidade || {}
  const responsavel = config?.responsavel || {}
  const livro = (config?.livro_sistema || 'StrikeCore').toUpperCase()

  // ---- Titulo ----
  let y = 16
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Anexo E', W / 2, y, { align: 'center' })
  y += 6
  doc.setFontSize(12.5)
  const titulo = doc.splitTextToSize(
    'COMPROVAÇÃO DE CUMPRIMENTO DE CALENDÁRIO ANUAL DE COMPETIÇÕES E DE OBTENÇÃO DE CLASSIFICAÇÃO MÍNIMA NO RANKING NACIONAL DE ATLETAS DE TIRO DESPORTIVO',
    W - 2 * M - 10
  )
  doc.text(titulo, W / 2, y, { align: 'center' })
  y += titulo.length * 5.4 + 1
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text('(art. 35 do Decreto nº 11.615/2023)', W / 2, y, { align: 'center' })
  y += 6

  // ---- Entidade ----
  y = sectionCaption(doc, y, 'Dados da Entidade de Tiro de Vinculação')
  autoTable(doc, {
    ...GRID,
    startY: y,
    body: [
      [{ content: `Nome: ${entidade.nome || ''}`, styles: { fontStyle: 'bold' } }, { content: `CNPJ: ${entidade.cnpj || ''}`, styles: { fontStyle: 'bold', cellWidth: 48 } }],
      [{ content: `Certificado de Registro: ${entidade.cr_numero || ''}`, styles: { fontStyle: 'bold' } }, { content: `Data: ${fmtD(entidade.cr_data)}`, styles: { fontStyle: 'bold', cellWidth: 48 } }],
      [{ content: `Endereço: ${entidade.endereco || ''}`, colSpan: 2, styles: { fontStyle: 'bold' } }],
    ],
  })
  y = doc.lastAutoTable.finalY + 4

  // ---- Atirador ----
  y = sectionCaption(doc, y, 'Dados do Atirador Desportivo')
  const filiacaoRow = [
    { content: 'Filiação à Entidade de Tiro', styles: { fontStyle: 'bold' } },
    { content: `Número: ${atirador.filiacaoNumero || ''}`, styles: { fontStyle: 'bold', cellWidth: 45 } },
    { content: `Data: ${fmtD(atirador.filiacaoData)}`, styles: { fontStyle: 'bold', cellWidth: 45 } },
  ]
  autoTable(doc, {
    ...GRID,
    startY: y,
    body: [
      [{ content: `Nome: ${atirador.nome || ''}`, colSpan: 2, styles: { fontStyle: 'bold' } }, { content: `CPF: ${atirador.cpf || ''}`, styles: { fontStyle: 'bold', cellWidth: 45 } }],
      [{ content: `Certificado de Registro: ${atirador.cr || ''}`, colSpan: 2, styles: { fontStyle: 'bold' } }, { content: `Data: ${fmtD(atirador.crData)}`, styles: { fontStyle: 'bold', cellWidth: 45 } }],
      [{ content: `Endereço: ${atirador.endereco || ''}`, colSpan: 3, styles: { fontStyle: 'bold' } }],
      filiacaoRow,
    ],
  })
  y = doc.lastAutoTable.finalY + 5

  // ---- Habitualidade: restrito primeiro (como no modelo), depois permitido ----
  const blocos = [
    { uso: 'restrito', cabecalho: 'Calibre Restrito' },
    { uso: 'permitido', cabecalho: 'Calibre de uso permitido' },
  ]

  for (const bloco of blocos) {
    const doUso = sessions.filter((s) => s.uso === bloco.uso)
    if (doUso.length === 0) continue

    y = ensureSpace(doc, y, 40)
    y = sectionCaption(doc, y + 2, 'Dados da Habitualidade')

    // header do bloco: "Calibre Restrito | Tipo de Evento"
    autoTable(doc, {
      ...GRID,
      startY: y,
      body: [[
        { content: bloco.cabecalho, styles: { fontStyle: 'bold', halign: 'center' } },
        { content: 'Tipo de Evento', styles: { fontStyle: 'bold', halign: 'center', cellWidth: 52 } },
      ]],
    })
    y = doc.lastAutoTable.finalY

    // sub-blocos por calibre
    const calibres = [...new Set(doUso.map((s) => s.municao_calibre || s.arma_snapshot?.calibre || '—'))]
    for (const cal of calibres) {
      const doCal = doUso
        .filter((s) => (s.municao_calibre || s.arma_snapshot?.calibre || '—') === cal)
        .sort((a, b) => new Date(b.data_hora_evento) - new Date(a.data_hora_evento))

      y = ensureSpace(doc, y, 36)

      // nome do calibre
      autoTable(doc, {
        ...GRID,
        startY: y,
        body: [[{ content: String(cal).toUpperCase(), styles: { fontStyle: 'bold', halign: 'center' } }]],
      })
      y = doc.lastAutoTable.finalY

      // linhas de atividade
      autoTable(doc, {
        ...GRID,
        startY: y,
        head: [['', 'ORDEM', 'DATA-HORA', 'SIGMA', 'QTD MUNIÇÃO', 'TREINAMENTO OU COMPETIÇÃO']],
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineColor: [0, 0, 0], lineWidth: 0.25 },
        columnStyles: {
          0: { cellWidth: 7, halign: 'center' },
          1: { cellWidth: 62, fontSize: 6.6 },
          2: { cellWidth: 27, halign: 'center' },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 24, halign: 'center' },
          5: { halign: 'center', fontSize: 6.6 },
        },
        body: doCal.map((s, i) => [
          String(i + 1),
          ordemTexto(s.inciso_legal),
          fmtDH(s.data_hora_evento),
          s.arma_snapshot?.sigma || '',
          String(s.qtd_municao),
          eventoTexto(s),
        ]),
      })
      y = doc.lastAutoTable.finalY

      // registro de habitualidade do sub-bloco
      autoTable(doc, {
        ...GRID,
        startY: y,
        body: [[{ content: 'REGISTRO DE HABITUALIDADE', styles: { fontStyle: 'bold', halign: 'center' } }]],
      })
      y = doc.lastAutoTable.finalY
      autoTable(doc, {
        ...GRID,
        startY: y,
        head: [['LIVRO/SISTEMA:', 'FOLHA/NºREGISTRO:', 'DATA DO LANÇAMENTO:']],
        headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineColor: [0, 0, 0], lineWidth: 0.25 },
        columnStyles: {
          0: { halign: 'center', fontStyle: 'bold' },
          1: { cellWidth: 45, halign: 'center' },
          2: { cellWidth: 48, halign: 'center' },
        },
        body: doCal.map((s) => [
          `SISTEMA: ${livro}`,
          `${s.numero_registro}${s.folha ? ` / fl. ${s.folha}` : ''}`,
          fmtD(s.data_lancamento),
        ]),
      })
      y = doc.lastAutoTable.finalY
    }
    y += 4
  }

  if (sessions.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Sem registros de habitualidade no período.', W / 2, y + 6, { align: 'center' })
    y += 14
  }

  // ---- Fecho: cidade/data + assinatura do responsavel ----
  y = ensureSpace(doc, y, 56)
  y += 4
  const cidadeUf = entidade.cidade_uf || 'São Paulo - SP'
  const hoje = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.text(`${cidadeUf}, ${hoje}`, W / 2, y, { align: 'center' })

  // espaco reservado pro carimbo da assinatura eletronica (ICP-Brasil/gov.br)
  y += 34
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text((responsavel.nome || '').toUpperCase(), W / 2, y, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text((responsavel.cargo || 'Responsável Legal').toUpperCase(), W / 2, y + 4.5, { align: 'center' })

  return doc
}
