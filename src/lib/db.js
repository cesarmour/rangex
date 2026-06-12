import { supabase } from './supabase.js'

// ============ PROFILE ============

export async function loadProfile(userId) {
  if (!supabase || !userId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function updateProfile(userId, patch) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  const { error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}

// ============ ACERVO ============

export async function loadAcervo(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('acervo')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    arma: row.arma,
    calibre: row.calibre,
    sortOrder: row.sort_order,
    photoPath: row.photo_path || null,
  }))
}

export async function addAcervo(userId, { arma, calibre, sortOrder = 0 }) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  const { data, error } = await supabase
    .from('acervo')
    .insert({ user_id: userId, arma, calibre, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return {
    id: data.id,
    arma: data.arma,
    calibre: data.calibre,
    sortOrder: data.sort_order,
    photoPath: data.photo_path || null,
  }
}

export async function updateAcervo(itemId, patch) {
  if (!supabase) throw new Error('Não autenticado')
  const dbPatch = {}
  if (patch.arma !== undefined) dbPatch.arma = patch.arma
  if (patch.calibre !== undefined) dbPatch.calibre = patch.calibre
  if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder
  if (patch.photoPath !== undefined) dbPatch.photo_path = patch.photoPath
  const { error } = await supabase.from('acervo').update(dbPatch).eq('id', itemId)
  if (error) throw error
}

export async function deleteAcervo(itemId) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.from('acervo').delete().eq('id', itemId)
  if (error) throw error
}

export async function bulkInsertAcervo(userId, items) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  if (items.length === 0) return []
  const rows = items.map((item, i) => ({
    user_id: userId,
    arma: item.arma,
    calibre: item.calibre,
    sort_order: item.sortOrder ?? i,
  }))
  const { data, error } = await supabase.from('acervo').insert(rows).select()
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    arma: row.arma,
    calibre: row.calibre,
    sortOrder: row.sort_order,
  }))
}

// Idempotent seeding via DB RPC. Safe to call multiple times.
// Only seeds when profiles.acervo_seeded is false.
export async function seedDefaultAcervo(items) {
  if (!supabase) throw new Error('Não autenticado')
  if (!items || items.length === 0) return
  const payload = items.map((i) => ({ arma: i.arma, calibre: i.calibre }))
  const { error } = await supabase.rpc('seed_default_acervo', { p_items: payload })
  if (error) throw error
}

// ============ TRAININGS ============

// Boot/lista: traz os treinos SEM as fotos base64 (strip no servidor via RPC),
// pra nao baixar dezenas de MB no carregamento. Todos os dados de scoring
// continuam presentes. A foto vem sob demanda em getTrainingFull.
export async function loadTrainings(userId, { limit = 200 } = {}) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase.rpc('list_trainings_light', { p_limit: limit })
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    label: row.label,
    trainedAt: row.trained_at,
    club: row.club_name ? { name: row.club_name, address: row.club_address } : null,
    sessions: row.sessions || [],
  }))
}

// Detalhe completo de um treino (com as fotos), buscado so quando o treino e aberto.
export async function getTrainingFull(trainingId) {
  if (!supabase || !trainingId) return null
  const { data, error } = await supabase.rpc('get_training_full', { p_training_id: trainingId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    id: row.id,
    label: row.label,
    trainedAt: row.trained_at,
    club: row.club_name ? { name: row.club_name, address: row.club_address } : null,
    sessions: row.sessions || [],
  }
}

export async function saveTraining(userId, training) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  const row = {
    user_id: userId,
    label: training.label,
    trained_at: training.trainedAt || new Date().toISOString(),
    club_name: training.club?.name || null,
    club_address: training.club?.address || null,
    sessions: training.sessions,
  }
  const { data, error } = await supabase
    .from('trainings')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return {
    id: data.id,
    label: data.label,
    trainedAt: data.trained_at,
    club: data.club_name ? { name: data.club_name, address: data.club_address } : null,
    sessions: data.sessions,
  }
}

export async function deleteTraining(trainingId) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.from('trainings').delete().eq('id', trainingId)
  if (error) throw error
}

// ============ RANKING ============

export async function loadRanking(clubName = null) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('get_ranking', {
    p_club_name: clubName,
  })
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    totalTrainings: Number(row.total_trainings || 0),
    totalDisparos: Number(row.total_disparos || 0),
    totalPontos: Number(row.total_pontos || 0),
    avgPtsPerShot: Number(row.avg_pts_per_shot || 0),
    challengeWins: Number(row.challenge_wins || 0),
    lastTrainingAt: row.last_training_at,
  }))
}

// ============ DUELS (v2 - sanctioned between registered users) ============

export async function findDuelOpponents(clubName, query = '') {
  if (!supabase || !clubName) return []
  const { data, error } = await supabase.rpc('find_duel_opponents', {
    p_club_name: clubName,
    p_query: query || null,
  })
  if (error) throw error
  return (data || []).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    email: r.email,
    challengeWins: Number(r.challenge_wins || 0),
  }))
}

export async function createDuel({ opponentId, club, arma, calibre, distancia }) {
  if (!supabase) throw new Error('Não autenticado')
  const { data, error } = await supabase.rpc('create_duel', {
    p_opponent_id: opponentId,
    p_club_name: club?.name,
    p_club_address: club?.address || null,
    p_arma: arma,
    p_calibre: calibre,
    p_distancia: distancia || null,
  })
  if (error) throw error
  return data
}

export async function acceptDuel(duelId) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.rpc('accept_duel', { p_duel_id: duelId })
  if (error) throw error
}

export async function declineDuel(duelId) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.rpc('decline_duel', { p_duel_id: duelId })
  if (error) throw error
}

export async function cancelDuel(duelId) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.rpc('cancel_duel', { p_duel_id: duelId })
  if (error) throw error
}

export async function submitDuelResult(duelId, { pontos, disparos, quadrantes, photoPath }) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.rpc('submit_duel_result', {
    p_duel_id: duelId,
    p_pontos: pontos,
    p_disparos: disparos,
    p_quadrantes: quadrantes,
    p_photo_path: photoPath,
  })
  if (error) throw error
}

export async function listMyDuels(limit = 50) {
  if (!supabase) return []
  // Sweep expired first (fire and forget)
  supabase.rpc('sweep_expired_duels').then(() => {})
  const { data, error } = await supabase.rpc('list_my_duels', { p_limit: limit })
  if (error) throw error
  return (data || []).map(rowToDuel)
}

function rowToDuel(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status, // 'pending' | 'active' | 'completed' | 'declined' | 'expired' | 'cancelled'
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
    challengerId: row.challenger_id,
    challengerName: row.challenger_name,
    opponentId: row.opponent_id,
    opponentName: row.opponent_name,
    clubName: row.club_name,
    arma: row.arma,
    calibre: row.calibre,
    distancia: row.distancia ? Number(row.distancia) : null,
    challengerPontos: row.challenger_pontos,
    opponentPontos: row.opponent_pontos,
    challengerSubmitted: row.challenger_submitted,
    opponentSubmitted: row.opponent_submitted,
    challengerQuadrantes: row.challenger_quadrantes,
    opponentQuadrantes: row.opponent_quadrantes,
    challengerPhotoPath: row.challenger_photo_path,
    opponentPhotoPath: row.opponent_photo_path,
    winner: row.winner, // 'challenger' | 'opponent' | 'tie'
    iAm: row.i_am, // 'challenger' | 'opponent'
  }
}

export async function uploadChallengePhoto(userId, dataUrl) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) throw new Error('Foto inválida')
  const mediaType = match[1]
  const base64 = match[2]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mediaType })

  const ext = mediaType.split('/')[1].replace('+xml', '')
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from('challenge-photos')
    .upload(path, blob, { contentType: mediaType, upsert: false })
  if (error) throw error
  return path
}

export async function getChallengePhotoUrl(path, expiresIn = 60 * 60 * 24) {
  if (!supabase || !path) return null
  const { data, error } = await supabase.storage
    .from('challenge-photos')
    .createSignedUrl(path, expiresIn)
  if (error) return null
  return data.signedUrl
}

// ============ PHOTOS (Supabase Storage) ============

export async function uploadPhoto(userId, dataUrl) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) throw new Error('Foto inválida')
  const mediaType = match[1]
  const base64 = match[2]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mediaType })

  const ext = mediaType.split('/')[1].replace('+xml', '')
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from('target-photos')
    .upload(path, blob, { contentType: mediaType, upsert: false })
  if (error) throw error
  return path
}

export async function getSignedPhotoUrl(path, expiresIn = 60 * 60 * 24) {
  if (!supabase) return null
  const { data, error } = await supabase.storage
    .from('target-photos')
    .createSignedUrl(path, expiresIn)
  if (error) return null
  return data.signedUrl
}

// ============ ACERVO PHOTOS ============

export async function uploadAcervoPhoto(userId, dataUrl) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) throw new Error('Foto inválida')
  const mediaType = match[1]
  const base64 = match[2]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mediaType })

  const ext = mediaType.split('/')[1].replace('+xml', '')
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from('acervo-photos')
    .upload(path, blob, { contentType: mediaType, upsert: false })
  if (error) throw error
  return path
}

export async function getAcervoPhotoUrl(path, expiresIn = 60 * 60 * 24) {
  if (!supabase || !path) return null
  const { data, error } = await supabase.storage
    .from('acervo-photos')
    .createSignedUrl(path, expiresIn)
  if (error) return null
  return data.signedUrl
}

export async function deleteAcervoPhoto(path) {
  if (!supabase || !path) return
  await supabase.storage.from('acervo-photos').remove([path])
}

// ============ CAMPEONATOS ============

function rowToChampionship(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: row.name,
    shots: row.shots,
    targetType: row.target_type,
    targetPhotoPath: row.target_photo_path,
    scope: row.scope,
    clubs: row.clubs,
    arma: row.arma,
    calibre: row.calibre,
    endsAt: row.ends_at,
    status: row.status,
    submissionMode: row.submission_mode || 'best',
    organizerId: row.organizer_id,
    organizerName: row.organizer_name,
    judgeId: row.judge_id,
    judgeName: row.judge_name,
    iAmOrganizer: row.i_am_organizer,
    iAmJudge: row.i_am_judge,
    judgeInviteToken: row.judge_invite_token,
    mySubmissions: Number(row.my_submissions || 0),
    pendingCount: Number(row.pending_count || 0),
  }
}

export async function createChampionship({ name, shots, targetType, targetPhotoPath, scope, clubs, arma, calibre, endsAt, submissionMode = 'best' }) {
  if (!supabase) throw new Error('Não autenticado')
  const { data, error } = await supabase.rpc('create_championship', {
    p_name: name,
    p_shots: shots,
    p_target_type: targetType,
    p_target_photo_path: targetPhotoPath,
    p_scope: scope,
    p_clubs: clubs,
    p_arma: arma,
    p_calibre: calibre,
    p_ends_at: endsAt,
    p_submission_mode: submissionMode,
  })
  if (error) throw error
  return data // { id, judge_invite_token }
}

export async function listChampionships(limit = 100) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('list_championships', { p_limit: limit })
  if (error) throw error
  return (data || []).map(rowToChampionship)
}

export async function acceptJudgeInvite(token) {
  if (!supabase) throw new Error('Não autenticado')
  const { data, error } = await supabase.rpc('accept_judge_invite', { p_token: token })
  if (error) throw error
  return data // { id, name }
}

export async function submitChampionshipEntry(championshipId, photoPath) {
  if (!supabase) throw new Error('Não autenticado')
  const { data, error } = await supabase.rpc('submit_championship_entry', {
    p_championship_id: championshipId,
    p_photo_path: photoPath,
  })
  if (error) throw error
  return data
}

export async function listChampionshipSubmissions(championshipId) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('list_championship_submissions', {
    p_championship_id: championshipId,
  })
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    shooterId: row.shooter_id,
    shooterName: row.shooter_name,
    photoPath: row.photo_path,
    status: row.status,
    pontos: row.pontos,
    disparos: row.disparos,
    scoring: row.scoring,
    frame: row.frame,
    judgeNote: row.judge_note,
    reviewedAt: row.reviewed_at,
  }))
}

export async function judgeReviewSubmission({ submissionId, status, pontos, disparos, scoring, frame, note }) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.rpc('judge_review_submission', {
    p_submission_id: submissionId,
    p_status: status,
    p_pontos: pontos,
    p_disparos: disparos,
    p_scoring: scoring,
    p_frame: frame,
    p_note: note,
  })
  if (error) throw error
}

export async function championshipRanking(championshipId) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('championship_ranking', {
    p_championship_id: championshipId,
  })
  if (error) throw error
  return (data || []).map((row) => ({
    shooterId: row.shooter_id,
    shooterName: row.shooter_name,
    bestPontos: Number(row.best_pontos || 0),
    bestDisparos: Number(row.best_disparos || 0),
    approvedCount: Number(row.approved_count || 0),
    bestAt: row.best_at,
  }))
}

export async function closeChampionship(championshipId) {
  if (!supabase) throw new Error('Não autenticado')
  const { error } = await supabase.rpc('close_championship', { p_championship_id: championshipId })
  if (error) throw error
}

export async function uploadChampionshipPhoto(userId, dataUrl) {
  if (!supabase || !userId) throw new Error('Não autenticado')
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) throw new Error('Foto inválida')
  const mediaType = match[1]
  const base64 = match[2]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mediaType })

  const ext = mediaType.split('/')[1].replace('+xml', '')
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from('championship-photos')
    .upload(path, blob, { contentType: mediaType, upsert: false })
  if (error) throw error
  return path
}

export async function getChampionshipPhotoUrl(path, expiresIn = 60 * 60 * 24) {
  if (!supabase || !path) return null
  const { data, error } = await supabase.storage
    .from('championship-photos')
    .createSignedUrl(path, expiresIn)
  if (error) return null
  return data.signedUrl
}
