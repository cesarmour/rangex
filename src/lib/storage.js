// Versioned localStorage keys
const VERSION = 'v3'
const KEYS = {
  acervo: `sra.acervo.${VERSION}`,
  precos: `sra.precos.${VERSION}`,
  settings: `sra.settings.${VERSION}`,
  trainings: `sra.trainings.${VERSION}`,
  club: `sra.club.${VERSION}`,
}

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    return false
  }
}

export function removeKey(key) {
  try { localStorage.removeItem(key) } catch {}
}

export const storage = {
  loadAcervo: (fallback) => loadJSON(KEYS.acervo, fallback),
  saveAcervo: (v) => saveJSON(KEYS.acervo, v),
  loadPrecos: (fallback) => loadJSON(KEYS.precos, fallback),
  savePrecos: (v) => saveJSON(KEYS.precos, v),
  loadSettings: (fallback) => loadJSON(KEYS.settings, fallback),
  saveSettings: (v) => saveJSON(KEYS.settings, v),
  loadTrainings: (fallback = []) => loadJSON(KEYS.trainings, fallback),
  saveTrainings: (v) => saveJSON(KEYS.trainings, v),
  loadClub: () => loadJSON(KEYS.club, null),
  saveClub: (v) => saveJSON(KEYS.club, v),
  clearClub: () => removeKey(KEYS.club),
}
