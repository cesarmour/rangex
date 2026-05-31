import { useState, useMemo } from 'react'
import { Chart as ChartJS, registerables } from 'chart.js'
import { Chart } from 'react-chartjs-2'
import { evolutionByCalibre } from '../lib/stats.js'

ChartJS.register(...registerables)

export default function EvolutionScreen({ trainings }) {
  const evo = useMemo(() => evolutionByCalibre(trainings), [trainings])
  const [selected, setSelected] = useState(0)

  if (evo.length === 0) {
    return (
      <div className="min-h-screen-content flex flex-col items-center justify-center p-8 text-center bg-dark text-white">
        <div className="text-lg font-light mb-2">Sem dados de evolução ainda</div>
        <div className="text-xs text-stone-400 max-w-xs">
          Conforme você salvar treinos, vai aparecer aqui a evolução de pontos por tiro por calibre, com tendência e projeção.
        </div>
      </div>
    )
  }

  const current = evo[selected]

  return (
    <div className="bg-dark text-white pb-32 min-h-screen-content">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {/* Calibre selector */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {evo.map((e, i) => (
            <button
              key={e.calibre}
              onClick={() => setSelected(i)}
              className={`px-3 py-2 rounded-md text-xs font-mono whitespace-nowrap transition border ${
                selected === i
                  ? 'bg-red-tactical text-white border-red-tactical'
                  : 'bg-black/40 text-stone-300 border-white/10 hover:border-white/30'
              }`}
            >
              {e.calibre}
            </button>
          ))}
        </div>

        {/* Header */}
        <div className="evo-card relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-tactical" />
          <div className="p-6">
            <div className="text-[10px] tracking-[0.2em] text-orange-tactical uppercase border border-orange-tactical/30 inline-block px-2 py-1 mb-3 font-mono">
              Calibre · {current.calibre}
            </div>
            <h1 className="text-3xl font-display uppercase tracking-wide leading-none mb-2">
              Performance <span className="text-red-tactical">Tracker</span>
            </h1>
            <div className="text-[11px] tracking-[0.1em] text-stone-400 uppercase">
              {current.stats.sessions} sessões · {current.stats.totalShots} disparos · {current.stats.daysSpan} dias
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatBox label="Melhor" value={current.stats.best} unit="pts/disp" />
          <StatBox label="Base" value={current.stats.base} unit="pts/disp" />
          <StatBox
            label="Growth"
            value={(current.stats.growthPct >= 0 ? '+' : '') + current.stats.growthPct}
            unit="%"
            positive={current.stats.growthPct >= 0}
            negative={current.stats.growthPct < 0}
          />
          <StatBox label="R² tendência" value={current.stats.r2} unit="" />
        </div>

        {/* Chart */}
        <div className="evo-card">
          <div className="p-6">
            <div className="text-base font-display uppercase tracking-[0.08em] mb-1">
              Eficiência · Real & Forecast
            </div>
            <div className="text-[10px] tracking-[0.15em] text-stone-500 uppercase mb-4 font-mono">
              pts por disparo · eixo temporal real (dias)
            </div>
            <div className="h-72">
              <Chart
                type="scatter"
                data={buildChartData(current)}
                options={chartOptions(current)}
              />
            </div>
          </div>
        </div>

        {/* Detalhe por sessão */}
        <div className="evo-card">
          <div className="p-6">
            <div className="text-base font-display uppercase tracking-[0.08em] mb-3">
              Sessões registradas
            </div>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-stone-400 border-b border-white/10">
                    <th className="text-left py-2 px-2 font-normal tracking-wider">Data</th>
                    <th className="text-right py-2 px-2 font-normal tracking-wider">Disparos</th>
                    <th className="text-right py-2 px-2 font-normal tracking-wider">Pontos</th>
                    <th className="text-right py-2 px-2 font-normal tracking-wider">Pts/tiro</th>
                  </tr>
                </thead>
                <tbody>
                  {current.dataPoints.map((p, i) => {
                    const isBest = p.y === Number(current.stats.best)
                    return (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-2 px-2 text-stone-300">{p.label}</td>
                        <td className="py-2 px-2 text-right">{p.disparos}</td>
                        <td className="py-2 px-2 text-right">{p.pontos}</td>
                        <td className={`py-2 px-2 text-right font-bold ${isBest ? 'text-green-400' : ''}`}>
                          {p.y.toFixed(2)}{isBest && <span className="text-[8px] text-green-400 ml-1 tracking-wider">MAX</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, unit, positive, negative }) {
  return (
    <div className="evo-card p-4">
      <div className="text-[9px] tracking-[0.18em] text-stone-400 uppercase mb-1 font-mono">{label}</div>
      <div className={`text-2xl font-display font-semibold ${positive ? 'text-green-400' : negative ? 'text-red-400' : 'text-white'}`}>
        {value}
        {unit && <span className="text-[10px] text-stone-400 ml-1 font-mono">{unit}</span>}
      </div>
    </div>
  )
}

function buildChartData(evo) {
  return {
    datasets: [
      {
        label: 'Real',
        data: evo.dataPoints.map((p) => ({ x: p.x, y: p.y, label: p.label })),
        borderColor: '#E63946',
        backgroundColor: '#E63946',
        pointRadius: 6,
        pointHoverRadius: 9,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        showLine: true,
        borderWidth: 2.5,
        tension: 0,
      },
      {
        label: `Tendência (R²=${evo.stats.r2})`,
        data: evo.trendLine,
        borderColor: 'rgba(180,180,180,0.7)',
        backgroundColor: 'transparent',
        borderDash: [4, 4],
        pointRadius: 0,
        showLine: true,
        borderWidth: 1.5,
      },
      {
        label: 'Forecast',
        data: evo.forecast,
        borderColor: '#F4A261',
        backgroundColor: 'rgba(244,162,97,0.1)',
        borderDash: [8, 4],
        pointRadius: 0,
        showLine: true,
        borderWidth: 2,
      },
    ],
  }
}

function chartOptions(evo) {
  const allY = [
    ...evo.dataPoints.map((p) => p.y),
    ...evo.forecast.map((p) => p.y),
    ...evo.trendLine.map((p) => p.y),
  ]
  const yMin = Math.max(0, Math.floor(Math.min(...allY) - 0.5))
  const yMax = Math.ceil(Math.max(...allY) + 0.5)
  const allX = [...evo.dataPoints.map((p) => p.x), ...evo.forecast.map((p) => p.x)]
  const xMax = Math.max(...allX, 30)

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: {
          color: '#e8e8e8',
          font: { family: 'JetBrains Mono, monospace', size: 10 },
          padding: 12,
          usePointStyle: true,
          pointStyle: 'rectRounded',
          boxWidth: 12,
          boxHeight: 4,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: '#E63946',
        borderWidth: 1,
        titleFont: { family: 'Oswald, sans-serif', size: 13, weight: '600' },
        bodyFont: { family: 'JetBrains Mono, monospace', size: 11 },
        padding: 10,
        callbacks: {
          title: (items) => items[0].raw.label || `Dia ${items[0].raw.x}`,
          label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(2)} pts/disp`,
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        min: -2,
        max: xMax + 2,
        title: {
          display: true,
          text: 'DIAS DESDE 1ª SESSÃO',
          color: 'rgba(232,232,232,0.5)',
          font: { family: 'JetBrains Mono, monospace', size: 9 },
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          color: 'rgba(232,232,232,0.5)',
          font: { family: 'JetBrains Mono, monospace', size: 10 },
        },
      },
      y: {
        min: yMin,
        max: yMax,
        title: {
          display: true,
          text: 'PTS / DISPARO',
          color: 'rgba(232,232,232,0.5)',
          font: { family: 'JetBrains Mono, monospace', size: 9 },
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          color: 'rgba(232,232,232,0.5)',
          font: { family: 'JetBrains Mono, monospace', size: 10 },
        },
      },
    },
  }
}
