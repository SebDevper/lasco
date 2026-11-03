// Cliente mínimo de la API de efemérides JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api).
// Se llama a través del proxy de Vite (`/api/horizons`, ver vite.config.js) porque la API no permite CORS.

export const SOHO_ID = '-21' // SOHO, la nave que lleva el coronógrafo LASCO
export const EARTH_ID = '399'

const ENDPOINT = '/api/horizons'
const JD_UNIX_EPOCH = 2440587.5
const MS_PER_DAY = 86_400_000

const pad = (n) => String(n).padStart(2, '0')

// Horizons acepta 'YYYY-MM-DD HH:MM'. Usamos UTC (la diferencia con TDB, ~69 s, es irrelevante aquí).
function toHorizonsTime(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}`
}

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }

// Las efemérides de SOHO solo llegan hasta la última predicción publicada. Horizons responde, p. ej.:
// 'No ephemeris for target "SOHO (spacecraft)" after A.D. 2026-NOV-02 23:51:09.1825 TDB'
function parseEphemerisLimit(text) {
  const m = text.match(/No ephemeris for target .* after A\.D\. (\d{4})-([A-Z]{3})-(\d{2}) (\d{2}):(\d{2})/)
  if (!m) return null
  const [, y, mon, d, h, min] = m
  return new Date(Date.UTC(Number(y), MONTHS[mon], Number(d), Number(h), Number(min)))
}

class EphemerisLimitError extends Error {
  constructor(limit) {
    super(`Sin efemérides después de ${limit.toISOString()}`)
    this.limit = limit
  }
}

async function requestVectors(target, start, stop, stepMinutes) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${target}'`,
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'", // centro del Sol
    REF_PLANE: "'ECLIPTIC'",
    START_TIME: `'${toHorizonsTime(start)}'`,
    STOP_TIME: `'${toHorizonsTime(stop)}'`,
    STEP_SIZE: `'${stepMinutes} m'`,
    OUT_UNITS: "'KM-S'",
    VEC_TABLE: "'2'", // posición + velocidad
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'NO'",
  })

  const res = await fetch(`${ENDPOINT}?${params}`)
  if (!res.ok) throw new Error(`JPL Horizons respondió ${res.status}`)
  const body = await res.json()
  const text = body.result ?? ''

  const soe = text.indexOf('$$SOE')
  const eoe = text.indexOf('$$EOE')
  if (soe === -1 || eoe === -1) {
    const limit = parseEphemerisLimit(text)
    if (limit) throw new EphemerisLimitError(limit)
    throw new Error(body.error || text.trim().split('\n').slice(-3).join(' ') || 'Respuesta inesperada de Horizons')
  }

  return text
    .slice(soe + 5, eoe)
    .trim()
    .split('\n')
    .map((line) => {
      // JDTDB, fecha, X, Y, Z, VX, VY, VZ,
      const cols = line.split(',').map((c) => c.trim())
      const jd = Number(cols[0])
      const [x, y, z, vx, vy, vz] = cols.slice(2, 8).map(Number)
      return { time: new Date((jd - JD_UNIX_EPOCH) * MS_PER_DAY), pos: [x, y, z], vel: [vx, vy, vz] }
    })
}

/**
 * Descarga posiciones heliocéntricas (eclíptica J2000, km) de SOHO y de la Tierra para los últimos
 * `days` días hasta el último instante con efemérides disponibles.
 */
export async function fetchSohoAndEarth({ days, stepMinutes = 360, until = new Date() }) {
  let stop = new Date(Math.floor(until.getTime() / 60_000) * 60_000)
  let start = new Date(stop.getTime() - days * MS_PER_DAY)

  let soho
  try {
    soho = await requestVectors(SOHO_ID, start, stop, stepMinutes)
  } catch (err) {
    if (!(err instanceof EphemerisLimitError)) throw err
    stop = new Date(err.limit.getTime() - 60_000)
    start = new Date(stop.getTime() - days * MS_PER_DAY)
    soho = await requestVectors(SOHO_ID, start, stop, stepMinutes)
  }
  const earth = await requestVectors(EARTH_ID, start, stop, stepMinutes)

  const n = Math.min(soho.length, earth.length)
  return {
    samples: Array.from({ length: n }, (_, i) => ({
      time: soho[i].time,
      soho: soho[i],
      earth: earth[i],
    })),
    ephemerisEnd: stop,
  }
}
