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

// La conexión con JPL a veces falla de forma intermitente (el proxy responde 502/504 o se corta la red):
// se reintenta hasta 3 veces con espera creciente antes de mostrar el error.
const RETRYABLE = new Set([502, 503, 504])

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) })
      if (res.ok) return res
      if (!RETRYABLE.has(res.status) || i === attempts) throw new Error(`JPL Horizons respondió ${res.status}`)
    } catch (err) {
      if (i === attempts || err.message?.startsWith('JPL Horizons respondió')) throw err
    }
    await new Promise((r) => setTimeout(r, 1000 * i))
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

  const res = await fetchWithRetry(`${ENDPOINT}?${params}`)
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
      // Al segundo: el JD en coma flotante deja errores de microsegundos (01:56:59.9998 en vez de 01:57:00).
      const time = new Date(Math.round((jd - JD_UNIX_EPOCH) * 86_400) * 1000)
      return { time, pos: [x, y, z], vel: [vx, vy, vz] }
    })
}

/** `date` redondeada hacia abajo a un múltiplo de `minutes` contado desde 1970-01-01 00:00 UTC. */
const floorToStep = (date, minutes) => new Date(Math.floor(date.getTime() / (minutes * 60_000)) * minutes * 60_000)

/**
 * Descarga posiciones heliocéntricas (eclíptica J2000, km) de SOHO y de la Tierra para los últimos
 * `days` días hasta el último instante con efemérides disponibles.
 *
 * El fin se ancla a un múltiplo del paso en UTC (6 h → 00/06/12/18 UTC; 15 min → :00/:15/:30/:45): así la malla
 * de instantes no cambia cada minuto, el backend reutiliza las imágenes ya descargadas para ella (y solo acepta
 * esa malla en ventanas largas), y los instantes de distintos rangos coinciden.
 */
export async function fetchSohoAndEarth({ days, stepMinutes = 360, until = new Date() }) {
  let stop = floorToStep(until, stepMinutes)
  let start = new Date(stop.getTime() - days * MS_PER_DAY)

  let soho
  try {
    soho = await requestVectors(SOHO_ID, start, stop, stepMinutes)
  } catch (err) {
    if (!(err instanceof EphemerisLimitError)) throw err
    stop = floorToStep(new Date(err.limit.getTime() - 60_000), stepMinutes)
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
