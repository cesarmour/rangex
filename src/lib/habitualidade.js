// Modulo de Habitualidade (Portaria 260-COLOG/2025 + Decreto 11.615/2023).
// Logica pura, testavel em Node: motor de classificacao por energia,
// deduplicacao de eventos e calculo dos minimos por nivel.
// NUNCA fixar grupo direto por calibre: a classificacao e dirigida pelos
// dados da arma (tipo_fisico, energia_j, calibre_lisa_numero, semiautomatica).

// ---- Motor de classificacao (Arts. 11 e 12 do Decreto 11.615/2023) ----
// Limiares: 407 J separa curta permitida/restrita; 1.620 J separa longa
// raiada permitida/restrita; lisa restrita se calibre > 12 ou semiauto.
export const LIMIAR_CURTA_J = 407
export const LIMIAR_LONGA_RAIADA_J = 1620

export function classificarArma({ tipoFisico, energiaJ, calibreLisaNumero, semiauto }) {
  if (tipoFisico === 'curta') {
    return (energiaJ ?? 0) <= LIMIAR_CURTA_J
      ? { grupo: 1, uso: 'permitido', inciso: 'Art.11,I' }
      : { grupo: 4, uso: 'restrito', inciso: 'Art.12,III' }
  }
  if (tipoFisico === 'longa_raiada') {
    return (energiaJ ?? 0) <= LIMIAR_LONGA_RAIADA_J
      ? { grupo: 2, uso: 'permitido', inciso: 'Art.11,II' }
      : { grupo: 5, uso: 'restrito', inciso: 'Art.12,IV' }
  }
  if (tipoFisico === 'longa_lisa') {
    const restrito = (calibreLisaNumero != null && calibreLisaNumero > 12) || semiauto === true
    return restrito
      ? { grupo: 6, uso: 'restrito', inciso: 'Art.12,V' }
      : { grupo: 3, uso: 'permitido', inciso: 'Art.11,III' }
  }
  throw new Error('tipo_fisico invalido')
}

export function classificarClubGun(gun) {
  return classificarArma({
    tipoFisico: gun.tipo_fisico ?? gun.tipoFisico,
    energiaJ: gun.energia_j ?? gun.energiaJ,
    calibreLisaNumero: gun.calibre_lisa_numero ?? gun.calibreLisaNumero,
    semiauto: gun.semiautomatica ?? gun.semiauto,
  })
}

export const GRUPO_LABELS = {
  1: 'Grupo 1 · curta permitida (Art.11,I)',
  2: 'Grupo 2 · longa raiada permitida (Art.11,II)',
  3: 'Grupo 3 · longa lisa permitida (Art.11,III)',
  4: 'Grupo 4 · curta restrita (Art.12,III)',
  5: 'Grupo 5 · longa raiada restrita (Art.12,IV)',
  6: 'Grupo 6 · longa lisa restrita (Art.12,V)',
}

// ---- Deduplicacao de eventos (sec. 6.2 da spec) ----
// Sessoes de mesmo grupo + mesmo dia + mesma entidade contam como 1 evento.
function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dedupeEventos(sessions) {
  const seen = new Map()
  for (const s of sessions) {
    const key = `${s.grupo_no_evento}|${dayKey(s.data_hora_evento)}|${s.club_name || ''}`
    const prev = seen.get(key)
    // competicao prevalece sobre treinamento no mesmo dia/grupo
    if (!prev || (prev.tipo_evento === 'treinamento' && s.tipo_evento === 'competicao')) {
      seen.set(key, s)
    }
  }
  return [...seen.values()]
}

// ---- Minimos por nivel (sec. 6.1, por grupo, ultimos 12 meses) ----
export const MINIMOS_NIVEL = {
  1: { treinos: 8, competicoes: 0 },
  2: { treinos: 12, competicoes: 4 },
  3: { treinos: 20, competicoes: 6 },
  alto_rendimento: { treinos: 0, competicoes: 0 }, // calendario oficial (Port. Interministerial 30/2025)
}

// Retorna, por grupo usado nos ultimos 12 meses, eventos deduplicados e
// atingimento contra o minimo do nivel. Nivel 1 aceita treinos OU competicoes
// na mesma cota.
export function progressoHabitualidade(sessions, nivel, agora = new Date()) {
  const corte = new Date(agora)
  corte.setFullYear(corte.getFullYear() - 1)
  const recentes = sessions.filter((s) => new Date(s.data_hora_evento) >= corte)
  const eventos = dedupeEventos(recentes)
  const minimos = MINIMOS_NIVEL[nivel] || MINIMOS_NIVEL['1']

  const porGrupo = new Map()
  for (const e of eventos) {
    const g = e.grupo_no_evento
    if (!porGrupo.has(g)) porGrupo.set(g, { grupo: g, treinos: 0, competicoes: 0 })
    const acc = porGrupo.get(g)
    if (e.tipo_evento === 'competicao') acc.competicoes++
    else acc.treinos++
  }

  const out = []
  for (const acc of porGrupo.values()) {
    let treinosOk, compOk
    if (String(nivel) === '1') {
      treinosOk = acc.treinos + acc.competicoes >= minimos.treinos
      compOk = true
    } else {
      treinosOk = acc.treinos >= minimos.treinos
      compOk = acc.competicoes >= minimos.competicoes
    }
    out.push({
      ...acc,
      minTreinos: minimos.treinos,
      minCompeticoes: minimos.competicoes,
      atingido: treinosOk && compOk,
    })
  }
  out.sort((a, b) => a.grupo - b.grupo)
  return out
}
