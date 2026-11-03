const nf = (opts) => new Intl.NumberFormat('es', opts)

const int = nf({ maximumFractionDigits: 0 })
const one = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 })
const two = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 })
const four = nf({ minimumFractionDigits: 4, maximumFractionDigits: 4 })

export const fmtInt = (v) => int.format(v)
export const fmt1 = (v) => one.format(v)
export const fmt2 = (v) => two.format(v)
export const fmt4 = (v) => four.format(v)

/** Millones de km con 3 decimales: 147,912 M km */
export const fmtMkm = (km) => `${nf({ minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(km / 1e6)} M km`

/** Miles de km para ejes: 650 mil km → "650" */
export const fmtKkm = (km) => int.format(km / 1e3)

const dateOnly = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const pad = (n) => String(n).padStart(2, '0')

/** Marca de tiempo estilo terminal: "2026-11-02 23:50 UTC" */
export const fmtDateTime = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`

/** Barra de progreso en texto: "████████░░░░░░░░" */
export function asciiBar(done, total, width = 20) {
  const n = total ? Math.round((done / total) * width) : 0
  return '█'.repeat(n) + '░'.repeat(width - n)
}

export const fmtDay = (d) => dateOnly.format(d)

/** Diferencia entre la imagen y el instante seleccionado: "38 min antes", "2 h después", "mismo minuto". */
export function fmtOffset(imageTime, refTime) {
  const min = Math.round((imageTime - refTime) / 60_000)
  if (min === 0) return 'mismo minuto'
  const abs = Math.abs(min)
  const text = abs < 90 ? `${abs} min` : `${one.format(abs / 60)} h`
  return `${text} ${min < 0 ? 'antes' : 'después'}`
}
