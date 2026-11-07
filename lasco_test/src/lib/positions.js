// Posiciones heliocéntricas (eclíptica J2000, km y km/s) de SOHO y de la Tierra, servidas por el backend propio
// (lasco_backend, `GET /api/positions`). El backend las pide a JPL Horizons y las guarda: el navegador no habla con
// JPL.

const BACKEND = '/api/lasco'

// Con la caché vacía el backend tiene que consultar a JPL (hasta 3 consultas seguidas): se da margen. nginx corta a
// los 60 s con un 504, que se reintenta (para entonces el backend ya habrá guardado lo que alcanzó a bajar).
const REQUEST_TIMEOUT = 65_000
// El backend responde 502 si falla JPL; 503/504 o un corte de red vienen del proxy. Hasta 3 intentos con espera
// creciente antes de mostrar el error.
const RETRYABLE = new Set([502, 503, 504])

class BackendError extends Error {
  // `unreachable`: no hubo respuesta del backend (red, o el proxy respondió sin el `detail` del backend: 500 de Vite,
  // 502/503/504 de nginx). Con el backend en pie, un 502 trae `detail` («no se pudo consultar JPL Horizons»).
  constructor(message, { unreachable = false } = {}) {
    super(message)
    this.unreachable = unreachable
  }
}

async function fetchWithRetry(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
      if (res.ok) return res
      if (!RETRYABLE.has(res.status) || i === attempts) {
        // 422 (ventana fuera de los límites) y 502 traen un `detail` en español.
        const detail = await res
          .json()
          .then((body) => (typeof body?.detail === 'string' ? body.detail : null))
          .catch(() => null)
        const unreachable = !detail && (res.status === 500 || RETRYABLE.has(res.status))
        throw new BackendError(detail ?? `backend respondió ${res.status}`, { unreachable })
      }
    } catch (err) {
      if (err instanceof BackendError) throw err
      if (i === attempts) {
        if (err.name === 'TimeoutError') throw new BackendError('el backend no respondió a tiempo')
        throw new BackendError(`sin conexión con el backend (${err.message})`, { unreachable: true })
      }
    }
    await new Promise((r) => setTimeout(r, 1000 * i))
  }
}

const toVector = (v) => ({ pos: v.slice(0, 3), vel: v.slice(3, 6) })

/**
 * Posiciones de SOHO y de la Tierra para los últimos `days` días cada `stepMinutes`, hasta el último instante con
 * efemérides de SOHO.
 *
 * El fin lo decide el backend: el fin de las efemérides (o ahora) redondeado hacia abajo a un múltiplo del paso en
 * UTC (6 h → 00/06/12/18 UTC; 15 min → :00/:15/:30/:45). Así la malla de instantes no cambia cada minuto, el backend
 * reutiliza las imágenes ya descargadas para ella (y solo acepta esa malla en ventanas largas), y los instantes de
 * distintos rangos coinciden.
 */
export async function fetchSohoAndEarth({ days, stepMinutes = 360 }) {
  const params = new URLSearchParams({ days: String(days), stepMinutes: String(stepMinutes) })
  const res = await fetchWithRetry(`${BACKEND}/positions?${params}`)
  const body = await res.json()
  return {
    samples: body.samples.map((s) => {
      const time = new Date(s.time)
      return { time, soho: { time, ...toVector(s.soho) }, earth: { time, ...toVector(s.earth) } }
    }),
    ephemerisEnd: new Date(body.end),
  }
}
