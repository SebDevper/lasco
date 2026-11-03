import { useEffect, useState } from 'react'

// Imágenes de los coronógrafos LASCO (SOHO), servidas por el backend propio (lasco_backend).
// El front no descarga nada de Helioviewer: el backend lo hace y guarda las imágenes en disco.
// Vienen giradas con el norte solar hacia arriba.

const BACKEND = '/api/lasco'

export const INSTRUMENTS = {
  c2: { sourceId: 4, label: 'LASCO C2', field: 'de 1,5 a 6 radios solares' },
  c3: { sourceId: 5, label: 'LASCO C3', field: 'de 3,7 a 30 radios solares' },
}

// Límite por petición al backend (evita que una petición colgada bloquee la carga).
const REQUEST_TIMEOUT = 20_000
const withTimeout = (signal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]) : AbortSignal.timeout(REQUEST_TIMEOUT)

const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

// ── Backend ─────────────────────────────────────────────────────────────────────
// Ventanas que el backend tiene sincronizadas: { c2: [[inicioMs, finMs], …], c3: … }
let backendCoverage = {}

/** Estado del backend (o null si no está disponible). Actualiza la cobertura conocida. */
export async function fetchBackendStatus() {
  try {
    const res = await fetch(`${BACKEND}/status`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`backend respondió ${res.status}`)
    const status = await res.json()
    backendCoverage = Object.fromEntries(
      Object.entries(status.coverage ?? {}).map(([inst, spans]) => [
        inst,
        spans.map(([a, b]) => [Date.parse(a), Date.parse(b)]),
      ]),
    )
    return status
  } catch {
    backendCoverage = {}
    return null
  }
}

export const coveredByBackend = (instrument, ms) => (backendCoverage[instrument] ?? []).some(([a, b]) => ms >= a && ms <= b)

/** Metadatos de una imagen del backend en el tamaño pedido (512 o 1024). */
function fromBackend(img, size) {
  const f = img.files[String(size)]
  return {
    id: img.id,
    instrument: img.instrument,
    time: new Date(img.time),
    url: BACKEND + f.url.replace(/^\/api/, ''),
    scale: f.scale,
    width: f.width,
    height: f.height,
    rsunPx: f.rsunPx,
    centerX: f.centerX,
    centerY: f.centerY,
    source: 'backend',
  }
}

async function backendJson(path, signal) {
  const res = await fetch(BACKEND + path, { signal: withTimeout(signal) })
  if (!res.ok) throw new Error(`backend respondió ${res.status}`)
  return res.json()
}

/**
 * Imagen guardada en el backend más cercana a `date`, en 1024 px:
 * { id, instrument, time, url, width, height, rsunPx, centerX, centerY, source }
 * `centerX/centerY` es el centro del Sol en píxeles (origen arriba a la izquierda) y `rsunPx` su radio.
 */
export async function closestImage(instrument, date) {
  const img = await backendJson(`/images/closest?instrument=${instrument}&date=${isoSeconds(date)}`)
  return fromBackend(img, 1024)
}

/**
 * Pide al backend que descargue (de Helioviewer) las imágenes de la línea de tiempo [start, end].
 * Hasta 48 h baja todas las imágenes; en rangos más largos, la más cercana a cada instante (cada `stepMinutes`).
 * Si ya hay una sincronización en curso, no lanza otra.
 */
export async function requestBackendSync({ start, end, stepMinutes }) {
  const res = await fetch(`${BACKEND}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: isoSeconds(start), end: isoSeconds(end), stepMinutes }),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 409) return { alreadyRunning: true }
  if (!res.ok) throw new Error(`backend respondió ${res.status}`)
  return res.json()
}

// ── Descarga previa para el timelapse ───────────────────────────────────────────
// Cada instante de la línea de tiempo recibe una imagen C2 y otra C3 de 512 px (del backend), guardada en memoria
// como blob URL para que al reproducir cada paso tenga su imagen al instante. Al pausar se carga la de 1024 px.

const PREVIEW_SIZE = 512
const frames = new Map() // `${instrumento}-${ms}` → metadatos con `url` = blob URL local
const blobs = new Map() // url → Promise<blob URL> (varios instantes pueden compartir imagen)

const frameKey = (instrument, ms) => `${instrument}-${ms}`

/** LASCO toma imágenes cada ~12–20 min; si la más cercana está a más de 3 h, hay un hueco en los datos. */
export const isDataGap = (image, time) => Math.abs(image.time - time) > 3 * 3_600_000

function blobUrl(url, signal) {
  if (!blobs.has(url)) {
    const p = fetch(url, { signal: withTimeout(signal) })
      .then((res) => {
        if (!res.ok) throw new Error(`respuesta ${res.status}`)
        return res.blob()
      })
      .then((blob) => URL.createObjectURL(blob))
    blobs.set(url, p)
    p.catch(() => blobs.delete(url))
  }
  return blobs.get(url)
}

/** Imágenes ya descargadas para un instante (o null). */
export function framesAt(ms) {
  return { c2: frames.get(frameKey('c2', ms)) ?? null, c3: frames.get(frameKey('c3', ms)) ?? null }
}

/** ¿Están las dos imágenes de este instante descargadas? */
export const hasFrames = (ms) => frames.has(frameKey('c2', ms)) && frames.has(frameKey('c3', ms))

/** La imagen de `sorted` (ordenada por tiempo) más cercana a `ms`. */
function nearest(sorted, ms) {
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].time < ms) lo = mid + 1
    else hi = mid
  }
  const a = sorted[lo]
  const b = sorted[lo - 1]
  return b && Math.abs(b.time - ms) <= Math.abs(a.time - ms) ? b : a
}

/**
 * Prepara desde el backend las imágenes C2 y C3 de cada instante de `times` (Date[]) que esté dentro de sus
 * ventanas sincronizadas: una consulta por coronógrafo y descarga local de los JPG de 512 px.
 * `onProgress({ done, failed, total })` se llama tras cada imagen.
 */
export async function prefetchFrames(times, { onProgress, signal, concurrency = 8 } = {}) {
  const jobs = []
  for (const t of times) {
    for (const inst of Object.keys(INSTRUMENTS)) {
      const ms = t.getTime()
      if (!frames.has(frameKey(inst, ms)) && coveredByBackend(inst, ms)) jobs.push([inst, t])
    }
  }
  const progress = { done: 0, failed: 0, total: jobs.length }
  onProgress?.({ ...progress })
  if (!jobs.length) return progress

  // Todas las imágenes del rango (con 6 h de margen para los huecos de datos), una consulta por coronógrafo.
  const ms = jobs.map(([, t]) => t.getTime())
  const start = new Date(Math.min(...ms) - 6 * 3_600_000)
  const end = new Date(Math.max(...ms) + 6 * 3_600_000)
  const lists = {}
  for (const inst of Object.keys(INSTRUMENTS)) {
    const { images } = await backendJson(
      `/images?instrument=${inst}&start=${isoSeconds(start)}&end=${isoSeconds(end)}`,
      signal,
    )
    lists[inst] = images.map((img) => ({ ...img, time: Date.parse(img.time) }))
  }

  let next = 0
  async function worker() {
    while (next < jobs.length && !signal?.aborted) {
      const [inst, t] = jobs[next++]
      try {
        if (!lists[inst].length) throw new Error('sin imágenes en el backend')
        const meta = fromBackend(nearest(lists[inst], t.getTime()), PREVIEW_SIZE)
        const url = await blobUrl(meta.url, signal)
        frames.set(frameKey(inst, t.getTime()), { ...meta, url })
      } catch {
        if (signal?.aborted) return
        progress.failed++
      }
      progress.done++
      onProgress?.({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return progress
}

/**
 * Imágenes C2 y C3 para `time`. Si están descargadas se muestran al instante (útil al reproducir);
 * cuando el instante deja de cambiar se carga la versión de 1024 px.
 */
export function useLascoImages(time, delay = 400) {
  const [state, setState] = useState({ c2: null, c3: null, loading: false, error: null })
  const ts = time?.getTime()

  useEffect(() => {
    if (ts == null) return
    let cancelled = false
    const quick = framesAt(ts)
    if (quick.c2 || quick.c3) {
      setState((s) => ({ c2: quick.c2 ?? s.c2, c3: quick.c3 ?? s.c3, loading: false, error: null }))
    }
    const id = setTimeout(() => {
      setState((s) => ({ ...s, loading: true, error: null }))
      const date = new Date(ts)
      Promise.all([closestImage('c2', date), closestImage('c3', date)])
        .then(([c2, c3]) => !cancelled && setState({ c2, c3, loading: false, error: null }))
        .catch((err) => !cancelled && setState((s) => ({ ...s, loading: false, error: err.message })))
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [ts, delay])

  return state
}

// ── Detalle al pausar: encabezado FITS y eventos solares (vía backend) ──────────

const headerCache = new Map()

/** Encabezado FITS resumido de una imagen (exposición, filtro, campo, orientación de SOHO…). */
export function fetchImageHeader(id) {
  if (!headerCache.has(id)) {
    const p = backendJson(`/images/${id}/header`)
    headerCache.set(id, p)
    p.catch(() => headerCache.delete(id))
  }
  return headerCache.get(id)
}

const eventsCache = new Map()
const toDate = (v) => (v ? new Date(v) : null)

/** CME (CACTus) y fulguraciones (GOES) del HEK que se solapan con [start, end]. */
export function fetchEvents(start, end) {
  const key = `${start.getTime()}-${end.getTime()}`
  if (!eventsCache.has(key)) {
    const p = backendJson(`/events?start=${isoSeconds(start)}&end=${isoSeconds(end)}`).then((d) => ({
      error: d.error,
      events: d.events.map((e) => ({ ...e, start: toDate(e.start), end: toDate(e.end), peak: toDate(e.peak) })),
    }))
    eventsCache.set(key, p)
    p.catch(() => eventsCache.delete(key))
  }
  return eventsCache.get(key)
}

/** ¿La CME estaba en el campo de LASCO cuando se tomó la imagen? (CACTus da su primera y última detección.) */
export const cmeVisibleAt = (cme, time) => cme.start - 15 * 60_000 <= time && time <= cme.end.getTime() + 15 * 60_000

export const EVENTS_WINDOW_H = 6

/**
 * Detalle de las imágenes del instante `time`, solo con el timelapse en pausa: encabezados FITS de C2 y C3 y
 * eventos solares ±EVENTS_WINDOW_H horas. Mientras se reproduce devuelve { paused: false }.
 */
export function useLascoDetails(lasco, time, paused, delay = 300) {
  const [state, setState] = useState({ paused, headers: {}, events: null, eventsError: null, loading: false })
  const ts = time?.getTime()
  const c2 = lasco.c2?.id
  const c3 = lasco.c3?.id

  useEffect(() => {
    if (!paused || ts == null) {
      setState((s) => ({ ...s, paused: false }))
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, paused: true, loading: true }))
    const id = setTimeout(async () => {
      // Ventana redondeada a la hora: instantes cercanos comparten la misma consulta (y su caché).
      const hour = Math.round(ts / 3_600_000) * 3_600_000
      const win = EVENTS_WINDOW_H * 3_600_000
      const [h2, h3, ev] = await Promise.allSettled([
        c2 ? fetchImageHeader(c2) : null,
        c3 ? fetchImageHeader(c3) : null,
        fetchEvents(new Date(hour - win), new Date(hour + win)),
      ])
      if (cancelled) return
      setState({
        paused: true,
        loading: false,
        headers: { c2: h2.value ?? null, c3: h3.value ?? null },
        events: ev.status === 'fulfilled' ? ev.value.events : null,
        eventsError: ev.status === 'fulfilled' ? ev.value.error : ev.reason?.message,
      })
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [paused, ts, c2, c3, delay])

  return state
}
