import { useMemo, useRef, useState } from 'react'
import { niceTicks, useElementSize } from '../lib/chart.js'
import { fmtDateTime, fmtInt, fmtKkm } from '../lib/format.js'

const PAD = { top: 12, right: 16, bottom: 40, left: 52 }

/**
 * Órbita halo de SOHO alrededor de L1 vista desde la Tierra (plano Y–Z del sistema rotatorio).
 * Ejes con la misma escala para no deformar la órbita.
 */
export default function HaloChart({ samples, selected, onSelect }) {
  const wrapRef = useRef(null)
  const { width } = useElementSize(wrapRef)
  const height = Math.max(240, Math.min(340, width * 0.75))
  const [hover, setHover] = useState(null)

  const geo = useMemo(() => {
    if (!samples.length || !width) return null
    const ys = samples.map((s) => s.relL1[1])
    const zs = samples.map((s) => s.relL1[2])
    const yt = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys), 5)
    const zt = niceTicks(Math.min(0, ...zs), Math.max(0, ...zs), 4)
    const innerW = width - PAD.left - PAD.right
    const innerH = height - PAD.top - PAD.bottom
    // Misma escala (px por km) en ambos ejes.
    const k = Math.min(innerW / (yt.at(-1) - yt[0]), innerH / (zt.at(-1) - zt[0]))
    const cx = PAD.left + innerW / 2
    const cy = PAD.top + innerH / 2
    const midY = (yt[0] + yt.at(-1)) / 2
    const midZ = (zt[0] + zt.at(-1)) / 2
    const x = (v) => cx + (v - midY) * k
    const y = (v) => cy - (v - midZ) * k
    // Recalcular marcas para el rango visible con la escala común.
    const yTicks = niceTicks((PAD.left - cx) / k + midY, (width - PAD.right - cx) / k + midY, 6).filter(
      (t) => x(t) >= PAD.left - 0.5 && x(t) <= width - PAD.right + 0.5,
    )
    const zTicks = niceTicks(midZ - (innerH / 2) / k, midZ + (innerH / 2) / k, 5).filter(
      (t) => y(t) >= PAD.top - 0.5 && y(t) <= height - PAD.bottom + 0.5,
    )
    const path = samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.relL1[1]).toFixed(1)},${y(s.relL1[2]).toFixed(1)}`).join('')
    return { x, y, yTicks, zTicks, path }
  }, [samples, width, height])

  function nearest(evt) {
    const rect = evt.currentTarget.getBoundingClientRect()
    const px = evt.clientX - rect.left
    const py = evt.clientY - rect.top
    let best = 0
    let bestD = Infinity
    samples.forEach((s, i) => {
      const d = (geo.x(s.relL1[1]) - px) ** 2 + (geo.y(s.relL1[2]) - py) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return bestD < 40 ** 2 ? best : null
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onSelect(Math.min(samples.length - 1, selected + 1))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onSelect(Math.max(0, selected - 1))
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
          height={height}
          role="img"
          aria-label={`Órbita halo de SOHO alrededor de L1. Posición seleccionada: Y ${fmtKkm(cur.relL1[1])} mil km, Z ${fmtKkm(cur.relL1[2])} mil km.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerMove={(e) => setHover(nearest(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const i = nearest(e)
            if (i != null) onSelect(i)
          }}
        >
          <g className="chart__grid">
            {geo.yTicks.map((t) => (
              <line key={`y${t}`} x1={geo.x(t)} x2={geo.x(t)} y1={PAD.top} y2={height - PAD.bottom} />
            ))}
            {geo.zTicks.map((t) => (
              <line key={`z${t}`} x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} />
            ))}
          </g>
          <g className="chart__axis">
            {geo.yTicks.map((t) => (
              <text key={`yl${t}`} x={geo.x(t)} y={height - PAD.bottom + 16} textAnchor="middle">
                {fmtKkm(t)}
              </text>
            ))}
            {geo.zTicks.map((t) => (
              <text key={`zl${t}`} x={PAD.left - 8} y={geo.y(t) + 4} textAnchor="end">
                {fmtKkm(t)}
              </text>
            ))}
            <text x={width - PAD.right} y={height - 6} textAnchor="end">
              y: dirección del movimiento orbital [mil km]
            </text>
            <text x={12} y={PAD.top + 2} transform={`rotate(-90 12 ${PAD.top + 2})`} textAnchor="end">
              z: norte de la eclíptica [mil km]
            </text>
          </g>

          {/* L1 */}
          <g className="chart__ref">
            <line x1={geo.x(0) - 6} x2={geo.x(0) + 6} y1={geo.y(0)} y2={geo.y(0)} />
            <line x1={geo.x(0)} x2={geo.x(0)} y1={geo.y(0) - 6} y2={geo.y(0) + 6} />
            <text x={geo.x(0) + 9} y={geo.y(0) - 7}>L1</text>
          </g>

          <path className="chart__line" d={geo.path} />

          {tip && tip !== cur && (
            <circle className="chart__dot chart__dot--ghost" cx={geo.x(tip.relL1[1])} cy={geo.y(tip.relL1[2])} r={5} />
          )}
          <circle className="chart__dot" cx={geo.x(cur.relL1[1])} cy={geo.y(cur.relL1[2])} r={5} />
          <text className="chart__label" x={geo.x(cur.relL1[1]) + 10} y={geo.y(cur.relL1[2]) + 4}>
            soho
          </text>
        </svg>
      )}
      {tip && geo && (
        <div
          className="tooltip"
          style={{
            left: Math.min(width - 190, Math.max(0, geo.x(tip.relL1[1]) + 12)),
            top: Math.max(0, geo.y(tip.relL1[2]) - 70),
          }}
        >
          <div className="tooltip__title">{fmtDateTime(tip.time)}</div>
          <div className="tooltip__row">
            <strong>{fmtInt(tip.relL1[1] / 1e3)} mil km</strong> <span>y</span>
          </div>
          <div className="tooltip__row">
            <strong>{fmtInt(tip.relL1[2] / 1e3)} mil km</strong> <span>z</span>
          </div>
        </div>
      )}
    </div>
  )
}
