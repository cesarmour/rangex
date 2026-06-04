// Utilities for computing performance evolution from training history

function normalizeDate(iso) {
  return new Date(iso)
}

function daysBetween(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

// Linear regression on (x, y) points. Returns { slope, intercept, r2 }.
export function linearRegression(points) {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 }
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
  for (const { x, y } of points) {
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y
  }
  const meanX = sumX / n
  const meanY = sumY / n
  const denom = sumX2 - n * meanX * meanX
  const slope = denom === 0 ? 0 : (sumXY - n * meanX * meanY) / denom
  const intercept = meanY - slope * meanX
  // R^2
  let ssRes = 0
  for (const { x, y } of points) {
    const pred = slope * x + intercept
    ssRes += (y - pred) ** 2
  }
  const ssTot = sumY2 - n * meanY * meanY
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot)
  return { slope, intercept, r2 }
}

// Given a list of trainings, return list of { calibre, label, dataPoints, stats }
// Each dataPoint is { x: daysSinceFirst, y: ptsPerShot, label: dateLabel, disparos }
export function evolutionByCalibre(trainings) {
  // Collect all sessions: { trainedAt, calibre, arma, disparos, pontos }
  const allSessions = []
  for (const t of trainings) {
    const trainedAt = normalizeDate(t.trainedAt)
    for (const s of t.sessions || []) {
      if (!s.calibre || !s.disparos) continue
      allSessions.push({
        trainedAt,
        calibre: s.calibre,
        arma: s.arma || '—',
        disparos: Number(s.disparos) || 0,
        pontos: Number(s.pontos) || 0,
      })
    }
  }

  if (allSessions.length === 0) return []

  // Group by calibre and AGGREGATE within same training date.
  const grouped = new Map()
  for (const s of allSessions) {
    if (!grouped.has(s.calibre)) grouped.set(s.calibre, new Map())
    const dateMap = grouped.get(s.calibre)
    const dateKey = s.trainedAt.toISOString().slice(0, 10)
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, { trainedAt: s.trainedAt, disparos: 0, pontos: 0, armas: new Set() })
    }
    const agg = dateMap.get(dateKey)
    agg.disparos += s.disparos
    agg.pontos += s.pontos
    agg.armas.add(s.arma)
  }

  // Build evolution per calibre
  const result = []
  for (const [calibre, dateMap] of grouped.entries()) {
    const dailyPoints = Array.from(dateMap.values())
      .filter((d) => d.disparos > 0)
      .sort((a, b) => a.trainedAt - b.trainedAt)

    if (dailyPoints.length === 0) continue

    const first = dailyPoints[0].trainedAt
    const last = dailyPoints[dailyPoints.length - 1].trainedAt

    const dataPoints = dailyPoints.map((d) => ({
      x: daysBetween(first, d.trainedAt),
      y: Number((d.pontos / d.disparos).toFixed(2)),
      label: d.trainedAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      disparos: d.disparos,
      pontos: d.pontos,
      date: d.trainedAt,
    }))

    const ys = dataPoints.map((p) => p.y)
    const best = Math.max(...ys)
    const base = dataPoints[0].y
    const last_y = dataPoints[dataPoints.length - 1].y
    const growthPct = base > 0 ? Math.round(((last_y - base) / base) * 100) : 0
    const totalShots = dailyPoints.reduce((acc, d) => acc + d.disparos, 0)
    const totalPoints = dailyPoints.reduce((acc, d) => acc + d.pontos, 0)
    const reg = linearRegression(dataPoints)
    const daysTotal = daysBetween(first, last)

    // Forecast 30 more days
    const forecast = []
    for (let day = daysTotal; day <= daysTotal + 30; day += 2) {
      forecast.push({ x: day, y: Number((reg.slope * day + reg.intercept).toFixed(2)) })
    }

    // Trend line samples
    const trendLine = []
    for (let day = 0; day <= daysTotal; day += Math.max(1, Math.floor(daysTotal / 30))) {
      trendLine.push({ x: day, y: Number((reg.slope * day + reg.intercept).toFixed(2)) })
    }

    result.push({
      calibre,
      dataPoints,
      trendLine,
      forecast,
      stats: {
        best: best.toFixed(2),
        base: base.toFixed(2),
        current: last_y.toFixed(2),
        growthPct,
        r2: reg.r2.toFixed(2),
        slope: reg.slope,
        totalShots,
        totalPoints,
        sessions: dailyPoints.length,
        firstDate: first,
        lastDate: last,
        daysSpan: daysTotal,
      },
    })
  }

  // Sort by total shots descending
  return result.sort((a, b) => b.stats.totalShots - a.stats.totalShots)
}
