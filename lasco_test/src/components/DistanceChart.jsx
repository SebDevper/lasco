import { useMemo, useRef, useState } from 'react'
import { linear, niceTicks, useElementSize } from '../lib/chart.js'
import { fmtDateTime, fmtDay, fmtInt } from '../lib/format.js'

const PAD = { top: 12, right: 16, bottom: 28, left: 52 }
const HEIGHT = 300

/** Distancia SOHO–Tierra a lo largo del tiempo, con cruz de selección que sigue al puntero. */
export default function DistanceChart({ samples, selected, onSelect }) {
  const wrapRef = useRef(null)
  const { width } = useElementSize(wrapRef)
  const [hover, setHover] = useState(null)

  const geo = useMemo(() => {
    if (!samples.length || !width) return null
    const vals = samples.map((s) => s.earthDistKm)
    const yTicks = niceTicks(Math.min(...vals), Math.max(...vals), 4)
    const t0 = samples[0].time.getTime()
    const t1 = samples.at(-1).time.getTime()
    const x = linear(t0, t1, PAD.left, width - PAD.right)
    const y = linear(yTicks[0], yTicks.at(-1), HEIGHT - PAD.bottom, PAD.top)
    const xTicks = niceTimeTicks(t0, t1, Math.max(2, Math.floor((width - PAD.left - PAD.right) / 90)))
    const path = samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.time.getTime()).toFixed(1)},${y(s.earthDistKm).toFixed(1)}`).join('')
    const area = `${path}L${x(t1)},${HEIGHT - PAD.bottom}L${x(t0)},${HEIGHT - PAD.bottom}Z`
    return { x, y, yTicks, xTicks, path, area, t0, t1 }
  }, [samples, width])

  function indexAt(evt) {
    const rect = evt.currentTarget.getBoundingClientRect()
    const px = evt.clientX - rect.left
    const t = geo.t0 + ((px - PAD.left) / (width - PAD.left - PAD.right)) * (geo.t1 - geo.t0)
    let best = 0
    samples.forEach((s, i) => {
      if (Math.abs(s.time - t) < Math.abs(samples[best].time - t)) best = i
    })
    return best
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowRight') onSelect(Math.min(samples.length - 1, selected + 1))
    else if (e.key === 'ArrowLeft') onSelect(Math.max(0, selected - 1))
    else return
    e.preventDefault()
  }

  const cur = samples[selected]
  const tip = hover != null ? samples[hover] : null

  return (
    <div className="chart" ref={wrapRef}>
      {geo && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Distancia de SOHO a la Tierra. Valor seleccionado: ${fmtInt(cur.earthDistKm)} km el ${fmtDateTime(cur.time)}.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerMove={(e) => setHover(indexAt(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onSelect(indexAt(e))}
        >
          <g className="chart__grid">
            {geo.yTicks.map((t) => (
              <line key={t} x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} />
            ))}
          </g>
          <g className="chart__axis">
            {geo.yTicks.map((t) => (
              <text key={t} x={PAD.left - 8} y={geo.y(t) + 4} textAnchor="end">
                {fmtInt(t / 1e3)}
              </text>
            ))}
            {geo.xTicks.map((t) => (
              <text key={t} x={geo.x(t)} y={HEIGHT - 8} textAnchor="middle">
                {tickLabel(t)}
              </text>
            ))}
          </g>

          <path className="chart__area" d={geo.area} />
          <path className="chart__line" d={geo.path} />

          {/* Instante seleccionado */}
          <line
            className="chart__selected"
            x1={geo.x(cur.time.getTime())}
            x2={geo.x(cur.time.getTime())}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
          />
          <circle className="chart__dot" cx={geo.x(cur.time.getTime())} cy={geo.y(cur.earthDistKm)} r={5} />

          {tip && (
            <>
              <line
                className="chart__crosshair"
                x1={geo.x(tip.time.getTime())}
                x2={geo.x(tip.time.getTime())}
                y1={PAD.top}
                y2={HEIGHT - PAD.bottom}
              />
              <circle className="chart__dot chart__dot--ghost" cx={geo.x(tip.time.getTime())} cy={geo.y(tip.earthDistKm)} r={4} />
            </>
          )}
        </svg>
      )}
      {tip && geo && (
        <div
          className="tooltip"
          style={{ left: Math.min(width - 190, Math.max(0, geo.x(tip.time.getTime()) + 12)), top: PAD.top }}
        >
          <div className="tooltip__title">{fmtDateTime(tip.time)}</div>
          <div className="tooltip__row">
            <strong>{fmtInt(tip.earthDistKm)} km</strong> <span>dist_tierra</span>
          </div>
        </div>
      )}
    </div>
  )
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Marcas del eje de tiempo (UTC). Rangos de hasta 3 días: cada 1, 2, 3, 6 o 12 h;
 * más largos: a medianoche, cada 1, 2, 7, 14 o 30 días según el espacio.
 */
function niceTimeTicks(t0, t1, maxTicks) {
  const hours = (t1 - t0) / HOUR
  const stepMs =
    hours <= 72
      ? ([1, 2, 3, 6, 12].find((h) => hours / h <= maxTicks) ?? 24) * HOUR
      : ([1, 2, 7, 14, 30, 60].find((d) => hours / 24 / d <= maxTicks) ?? 90) * DAY
  const first = Math.ceil(t0 / stepMs) * stepMs
  const ticks = []
  for (let t = first; t <= t1; t += stepMs) ticks.push(t)
  return ticks
}

/** Etiqueta de una marca: "14:00" dentro del día, la fecha ("3 nov") a medianoche. */
function tickLabel(t) {
  const d = new Date(t)
  if (t % DAY === 0) return fmtDay(d)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
