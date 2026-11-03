import { useEffect, useMemo, useRef, useState } from 'react'
import SunScene from '../components/SunScene.jsx'
import HaloChart from '../components/HaloChart.jsx'
import DistanceChart from '../components/DistanceChart.jsx'
import LascoImages, { GapBadge } from '../components/LascoImages.jsx'
import Pane, { Comment } from '../components/Pane.jsx'
import { fetchSohoAndEarth } from '../lib/horizons.js'
import {
  INSTRUMENTS,
  fetchBackendStatus,
  hasFrames,
  isDataGap,
  prefetchFrames,
  requestBackendSync,
  useLascoImages,
} from '../lib/lasco.js'
import { AU_KM, describeSample } from '../lib/orbit.js'
import { asciiBar, fmt1, fmt2, fmt4, fmtDateTime, fmtInt, fmtMkm, fmtOffset } from '../lib/format.js'

// Rangos de la línea de tiempo. El de 24 h usa pasos de 15 min (LASCO toma imágenes cada ~12 min),
// los de varios días pasos de 6 h. `rowEvery`: cada cuántos minutos va una fila en la tabla.
const RANGES = [
  { id: '24h', label: '24h', days: 1, stepMinutes: 15, rowEvery: 60, rowLabel: 'una por hora' },
  { id: '30d', label: '30d', days: 30, stepMinutes: 360, rowEvery: 1440, rowLabel: 'una por día' },
  { id: '90d', label: '90d', days: 90, stepMinutes: 360, rowEvery: 1440, rowLabel: 'una por día' },
  { id: '180d', label: '180d', days: 180, stepMinutes: 360, rowEvery: 1440, rowLabel: 'una por día' },
]
const VIEWS = [
  { id: 'overview', label: 'general' },
  { id: 'sun', label: 'sol' },
  { id: 'soho', label: 'soho+l1' },
  { id: 'lasco', label: 'lasco' },
]
// Filtros de la vista 3D: dibujarla con caracteres de texto (ASCII, en verde o con los colores reales)
// o como un dibujo punteado.
// `flag`: cómo aparece en la línea de comando de la vista (--filtro …).
const FILTERS = [
  { id: 'off', label: 'normal' },
  { id: 'ascii', label: 'ascii', flag: 'ascii' },
  { id: 'ascii-color', label: 'ascii color', flag: 'ascii-color' },
  { id: 'stipple', label: 'punteado', flag: 'punteado' },
  { id: 'stipple-color', label: 'punteado color', flag: 'punteado-color' },
]
const FILTER_KEY = 'lasco_test.filtro3d'

function loadFilter() {
  try {
    const saved = localStorage.getItem(FILTER_KEY)
    return FILTERS.some((f) => f.id === saved) ? saved : 'off'
  } catch {
    return 'off'
  }
}

function Stat({ label, value, detail }) {
  return (
    <div className="kv__row">
      <dt className="kv__key">{label}</dt>
      <dd className="kv__value">{value}</dd>
      {detail && <dd className="kv__detail"># {detail}</dd>}
    </div>
  )
}

/** Línea de la consola con el estado del backend de imágenes. */
function BackendLine({ backend }) {
  if (backend === undefined) {
    return (
      <div>
        <span className="tag tag--info">[..]</span> consultando backend lasco<span className="cursor cursor--inline" />
      </div>
    )
  }
  if (backend === null) {
    return (
      <div>
        <span className="tag tag--error">[error]</span> backend lasco no disponible · sin él no hay imágenes{' '}
        <span className="comment-inline"># cd lasco_backend && .venv/bin/uvicorn app.main:app --port 8000</span>
      </div>
    )
  }
  const { sync, images, coverage } = backend
  if (sync.running) {
    return (
      <div className="console__progress">
        <span className="tag tag--info">[sync]</span> backend lasco descargando de helioviewer
        {sync.mode === 'sampled' ? ' (una imagen por instante)' : ' (todas las imágenes)'}{' '}
        <span className="ascii-bar">{asciiBar(sync.done, sync.total)}</span> {fmtInt(sync.done)}/{fmtInt(sync.total)}
        {sync.total ? '' : ' · listando imágenes'}
      </div>
    )
  }
  const count = Object.values(images).reduce((n, v) => n + v.count, 0)
  const spans = coverage.c2 ?? coverage.c3 ?? []
  const span = ([a, b]) => `${fmtDateTime(new Date(a)).replace(' UTC', '')} → ${fmtDateTime(new Date(b))}`
  return (
    <div>
      <span className={`tag ${sync.failed || sync.error ? 'tag--warn' : 'tag--ok'}`}>
        {sync.failed || sync.error ? '[!]' : '[ok]'}
      </span>{' '}
      backend lasco · {fmtInt(count)} imágenes en disco
      {spans.length ? ` · cubre ${spans.map(span).join(', ')}` : ' · sin ventanas completas'}
      {sync.failed ? ` · ${fmtInt(sync.failed)} fallaron en la última sincronización` : ''}
    </div>
  )
}

export default function Dashboard() {
  const [rangeId, setRangeId] = useState('180d')
  const range = RANGES.find((r) => r.id === rangeId)
  const [data, setData] = useState(null) // { samples, ephemerisEnd }
  const [status, setStatus] = useState({ loading: true, error: null })
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState({ id: 'overview', nonce: 0 })
  const [playing, setPlaying] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [instrument, setInstrument] = useState('c2')
  const [mix, setMix] = useState(0.85)
  const [filter, setFilter] = useState(loadFilter)

  function changeFilter(id) {
    setFilter(id)
    try {
      localStorage.setItem(FILTER_KEY, id)
    } catch {
      // sin almacenamiento disponible: el filtro dura solo esta visita
    }
  }
  const [prefetch, setPrefetch] = useState(null) // { running, done, failed, total }
  const [backend, setBackend] = useState(undefined) // undefined: consultando · null: no disponible · objeto: /status
  const [syncError, setSyncError] = useState(null)
  const prefetchAbort = useRef(null)
  const syncPending = useRef(false)
  const samplesRef = useRef([])
  samplesRef.current = data?.samples ?? []

  // "Actualizar": recarga las efemérides y pide al backend que descargue las imágenes de toda la línea de tiempo.
  // El front no descarga nada de Helioviewer: cuando el backend termina, trae de él las imágenes (rápido, en local).
  function refresh() {
    syncPending.current = true
    setReloadKey((k) => k + 1)
  }

  // Carga en memoria, desde el backend, las imágenes de los instantes que ya tiene sincronizados.
  function startPrefetch(described) {
    prefetchAbort.current?.abort()
    const ctrl = new AbortController()
    prefetchAbort.current = ctrl
    setPrefetch({ running: true, done: 0, failed: 0, total: 0 })
    prefetchFrames(described.map((s) => s.time), {
      signal: ctrl.signal,
      onProgress: (p) => !ctrl.signal.aborted && setPrefetch({ ...p, running: true }),
    })
      .then((p) => !ctrl.signal.aborted && setPrefetch({ ...p, running: false }))
      .catch(() => !ctrl.signal.aborted && setPrefetch((p) => ({ ...p, running: false, error: true })))
  }

  // Tras cargar las posiciones: consultar el backend, pedirle la sincronización si se pulsó "actualizar"
  // y traer lo que ya tenga.
  async function loadImages(described, currentRange) {
    const st = await fetchBackendStatus()
    setBackend(st)
    if (!st) return
    if (syncPending.current) {
      syncPending.current = false
      setSyncError(null)
      try {
        await requestBackendSync({
          start: described[0].time,
          end: described.at(-1).time,
          stepMinutes: currentRange.stepMinutes,
        })
        setBackend(await fetchBackendStatus()) // ahora con sync.running → empieza el seguimiento
      } catch (err) {
        setSyncError(err.message)
      }
    }
    startPrefetch(described)
  }

  // Mientras el backend sincroniza: consultar su estado cada 2 s y, al terminar, cargar lo nuevo.
  const backendSyncing = Boolean(backend?.sync?.running)
  useEffect(() => {
    if (!backendSyncing) return
    const id = setInterval(async () => {
      const st = await fetchBackendStatus()
      setBackend(st)
      if (st && !st.sync.running) startPrefetch(samplesRef.current)
    }, 2000)
    return () => clearInterval(id)
  }, [backendSyncing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => prefetchAbort.current?.abort(), [])

  useEffect(() => {
    let cancelled = false
    setStatus({ loading: true, error: null })
    setPlaying(false)
    fetchSohoAndEarth({ days: range.days, stepMinutes: range.stepMinutes })
      .then(({ samples, ephemerisEnd }) => {
        if (cancelled) return
        if (!samples.length) throw new Error('Horizons no devolvió datos para ese rango')
        const described = samples.map(describeSample)
        setData({ samples: described, ephemerisEnd })
        setSelected(samples.length - 1)
        setStatus({ loading: false, error: null })
        loadImages(described, range)
      })
      .catch((err) => !cancelled && setStatus({ loading: false, error: err.message }))
    return () => {
      cancelled = true
    }
  }, [rangeId, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const samples = data?.samples ?? []
  const lastIndex = samples.length - 1

  // Reproducción: recorre la trayectoria hasta el último dato.
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setSelected((i) => Math.min(i + 1, lastIndex)), 50)
    return () => clearInterval(id)
  }, [playing, lastIndex])
  useEffect(() => {
    if (playing && selected >= lastIndex) setPlaying(false)
  }, [playing, selected, lastIndex])

  function togglePlay() {
    if (!playing && selected >= lastIndex) setSelected(0)
    setPlaying(!playing)
  }

  const cur = samples[Math.min(selected, samples.length - 1)]
  const track = useMemo(() => samples.map((s) => s.relEarth), [samples])
  const rowStride = Math.max(1, Math.round(range.rowEvery / range.stepMinutes))
  const dailyRows = useMemo(
    () => samples.filter((_, i) => i % rowStride === 0 || i === samples.length - 1),
    [samples, rowStride],
  )
  const lasco = useLascoImages(cur?.time)
  const lascoImage = lasco[instrument]
  const inLascoView = view.id === 'lasco'

  // Tramos de la línea de tiempo que ya tienen sus imágenes descargadas (se recalcula con cada avance).
  const coverage = useMemo(() => {
    const runs = []
    let count = 0
    samples.forEach((s, i) => {
      if (!hasFrames(s.time.getTime())) return
      count++
      const last = runs.at(-1)
      if (last && last[1] === i - 1) last[1] = i
      else runs.push([i, i])
    })
    return { runs, count }
  }, [samples, prefetch]) // eslint-disable-line react-hooks/exhaustive-deps

  function openLascoView(inst) {
    setInstrument(inst)
    setView({ id: 'lasco', nonce: view.nonce + 1 })
    document.querySelector('.pane--scene')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const viewCmd =
    (inLascoView
      ? `./vista --modo lasco --coronografo ${instrument}`
      : `./vista --modo ${VIEWS.find((v) => v.id === view.id).label}`) +
    (filter !== 'off' ? ` --filtro ${FILTERS.find((f) => f.id === filter).flag}` : '')

  return (
    <main className="dashboard">
      {/* ── Línea de comandos: rango, actualizar y estado ── */}
      <Pane id={0} title="consola" className="pane--console" label="Controles y estado">
        <div className="console">
          <div className="console__row">
            <span className="prompt">$</span>
            <span className="console__cmd">rango</span>
            <div className="segmented" role="group" aria-label="Rango de tiempo">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  className={r.id === rangeId ? 'is-active' : ''}
                  aria-pressed={r.id === rangeId}
                  onClick={() => setRangeId(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              className="btn"
              onClick={refresh}
              disabled={status.loading}
              title="Recarga las posiciones y descarga las imágenes LASCO de toda la línea de tiempo"
            >
              actualizar
            </button>
          </div>

          <div className="console__log" aria-live="polite">
            {status.loading ? (
              <div>
                <span className="tag tag--info">[..]</span> consultando jpl horizons<span className="cursor cursor--inline" />
              </div>
            ) : status.error ? (
              <div className="console__error" role="alert">
                <span className="tag tag--error">[error]</span> no se pudieron cargar las efemérides: {status.error}
                <span className="comment-inline"> # requiere npm run dev o npm run preview (proxy de vite)</span>{' '}
                <button className="btn btn--small" onClick={() => setReloadKey((k) => k + 1)}>
                  reintentar
                </button>
              </div>
            ) : (
              <div>
                <span className="tag tag--ok">[ok]</span> efemérides jpl horizons · último dato {fmtDateTime(data.ephemerisEnd)}
              </div>
            )}

            {data && <BackendLine backend={backend} />}

            {syncError && (
              <div>
                <span className="tag tag--error">[error]</span> no se pudo pedir la sincronización al backend: {syncError}
              </div>
            )}

            {data &&
              backend &&
              (prefetch?.running ? (
                <div className="console__progress">
                  <span className="tag tag--info">[carga]</span> imágenes lasco desde backend{' '}
                  <span className="ascii-bar">{asciiBar(prefetch.done, prefetch.total)}</span>{' '}
                  {fmtInt(prefetch.done)}/{fmtInt(prefetch.total)}
                </div>
              ) : coverage.count > 0 ? (
                <>
                  <div>
                    <span className={`tag ${prefetch?.failed || prefetch?.error ? 'tag--warn' : 'tag--ok'}`}>
                      {prefetch?.failed || prefetch?.error ? '[!]' : '[ok]'}
                    </span>{' '}
                    timelapse: {fmtInt(coverage.count)}/{fmtInt(samples.length)} instantes con imagen del backend
                    {prefetch?.failed ? ` · ${fmtInt(prefetch.failed)} imágenes no se pudieron cargar` : ''}
                    {prefetch?.error ? ' · error al consultar el backend' : ''}
                  </div>
                  {coverage.count < samples.length && !backendSyncing && (
                    <div>
                      <span className="tag tag--muted">[info]</span> el backend aún no tiene imágenes para todo el rango ·
                      ejecuta «actualizar» para que las descargue
                    </div>
                  )}
                </>
              ) : (
                !backendSyncing && (
                  <div>
                    <span className="tag tag--muted">[info]</span> el backend no tiene imágenes de este rango · ejecuta
                    «actualizar» para que las descargue
                  </div>
                )
              ))}
          </div>
        </div>
      </Pane>

      <div className={`dash-grid ${status.loading && data ? 'is-refreshing' : ''}`}>
        {/* ── Vista 3D ── */}
        <Pane
          id={1}
          title="vista-3d · sol · soho · l1"
          className="pane--scene"
          label="Vista 3D del Sol y de SOHO"
          actions={
            <div className="segmented segmented--small" role="group" aria-label="Vista de cámara">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  className={v.id === view.id ? 'is-active' : ''}
                  aria-pressed={v.id === view.id}
                  onClick={() => setView({ id: v.id, nonce: view.nonce + 1 })}
                >
                  {v.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="scene-cmd">
            <div className="pane__cmd">
              <span className="prompt">$</span> {viewCmd}
            </div>
            <div className="scene-cmd__filter">
              <span className="comment-inline"># filtro</span>
              <div className="segmented segmented--small" role="group" aria-label="Filtro de la vista 3D">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    className={f.id === filter ? 'is-active' : ''}
                    aria-pressed={f.id === filter}
                    onClick={() => changeFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="scene-wrap">
            <SunScene
              current={cur}
              track={track}
              view={view.id}
              viewNonce={view.nonce}
              lascoImage={lascoImage}
              mix={mix}
              filter={filter}
            />
            {!data && status.loading && (
              <div className="scene-overlay">
                cargando posición de soho<span className="cursor cursor--inline" />
              </div>
            )}

            {inLascoView && (
              <div className="lasco-controls">
                <div className="segmented segmented--small" role="group" aria-label="Coronógrafo">
                  {Object.entries(INSTRUMENTS).map(([id, inst]) => (
                    <button
                      key={id}
                      className={id === instrument ? 'is-active' : ''}
                      aria-pressed={id === instrument}
                      onClick={() => setInstrument(id)}
                      title={`${inst.label}: campo ${inst.field}`}
                    >
                      {id}
                    </button>
                  ))}
                </div>
                <label className="mix">
                  <span>3d</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={mix}
                    onChange={(e) => setMix(Number(e.target.value))}
                    aria-label="Mezcla entre el modelo 3D y la imagen LASCO"
                  />
                  <span>img</span>
                  <span className="mix__value">{Math.round(mix * 100)}%</span>
                </label>
                <div className="lasco-controls__meta">
                  {lascoImage ? (
                    <>
                      {instrument} @ {fmtDateTime(lascoImage.time)}
                      <span> ({fmtOffset(lascoImage.time, cur.time)})</span>
                      <GapBadge show={isDataGap(lascoImage, cur.time)} />
                    </>
                  ) : lasco.error ? (
                    <span className="tag tag--error">[error] sin imagen: {lasco.error}</span>
                  ) : (
                    <>
                      cargando imagen<span className="cursor cursor--inline" />
                    </>
                  )}
                </div>
              </div>
            )}

            <p className="scene-note">
              {inLascoView
                ? '# vista desde soho hacia el sol · norte solar arriba · el disco negro es el ocultador de lasco · rueda: zoom'
                : '# escala no real: sol ampliado, entorno de la tierra (l1 y órbita de soho) ×10 · arrastrar: rotar · rueda: zoom'}
            </p>
          </div>

          {cur && (
            <div className="timeline">
              <button className="btn btn--play" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproducir trayectoria'}>
                {playing ? 'pausa' : 'play'}
              </button>
              <div className="timeline__track">
                <input
                  type="range"
                  min={0}
                  max={samples.length - 1}
                  value={selected}
                  onChange={(e) => {
                    setPlaying(false)
                    setSelected(Number(e.target.value))
                  }}
                  aria-label="Instante seleccionado"
                  aria-valuetext={fmtDateTime(cur.time)}
                />
                {/* Tramos con imágenes LASCO descargadas */}
                <div className="timeline__coverage" aria-hidden="true" title="Tramos con imágenes LASCO descargadas">
                  {coverage.runs.map(([a, b]) => (
                    <span
                      key={a}
                      style={{
                        left: `${(a / samples.length) * 100}%`,
                        width: `${((b - a + 1) / samples.length) * 100}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="timeline__date">
                <span className="kv__key">t =</span> {fmtDateTime(cur.time)}
              </div>
            </div>
          )}
        </Pane>

        {/* ── Telemetría ── */}
        <aside className="side">
          <Pane id={2} title="telemetria" cmd="soho --telemetria" label="Telemetría de SOHO">
            {cur ? (
              <>
                <div className="hero">
                  <div className="kv__key">dist_sol</div>
                  <div className="hero__value">{fmtMkm(cur.sunDistKm)}</div>
                  <div className="comment-inline">
                    # {fmt4(cur.sunDistKm / AU_KM)} UA · {fmtInt(cur.sunDistKm / 695_700)} radios solares
                  </div>
                </div>
                <dl className="kv">
                  <Stat
                    label="dist_tierra"
                    value={`${fmtInt(cur.earthDistKm)} km`}
                    detail={`L1 a ${fmtInt(cur.l1Dist)} km de la Tierra`}
                  />
                  <Stat
                    label="sep_linea_sol_tierra"
                    value={`${fmtInt(cur.lateralKm)} km`}
                    detail={`ángulo Sol–Tierra–SOHO: ${fmt1(cur.sesAngleDeg)}°`}
                  />
                  <Stat
                    label="vel_heliocentrica"
                    value={`${fmt2(cur.speedKms)} km/s`}
                    detail={`respecto a la Tierra: ${fmt2(cur.speedRelEarthKms * 1000)} m/s`}
                  />
                  <Stat label="long_ecliptica" value={`${fmt1(cur.eclipticLonDeg)}°`} detail="eclíptica J2000, centro en el Sol" />
                </dl>
              </>
            ) : (
              <p className="comment">{status.loading ? '# cargando…' : '# sin datos'}</p>
            )}
          </Pane>

          <Pane id={3} title="man lasco" cmd="man lasco" label="Qué es LASCO">
            <div className="man">
              <div className="man__head">
                <span>LASCO(1)</span>
                <span>Instrumentos SOHO</span>
              </div>
              <h3>NOMBRE</h3>
              <p>lasco — coronógrafo de SOHO (ESA/NASA)</p>
              <h3>DESCRIPCIÓN</h3>
              <p>
                Tapa el disco solar para ver la corona y las eyecciones de masa coronal. SOHO orbita el punto L1, entre el Sol
                y la Tierra, y ve el Sol sin interrupciones.
              </p>
            </div>
          </Pane>
        </aside>

        {cur && (
          <>
            <LascoImages lasco={lasco} time={cur.time} onOpen={openLascoView} />

            <Pane
              id={5}
              title="orbita-halo"
              cmd={`soho --orbita --respecto-a l1 --rango ${range.label}`}
              label="Órbita halo alrededor de L1"
            >
              <Comment>vista desde la tierra hacia el sol</Comment>
              <HaloChart samples={samples} selected={selected} onSelect={setSelected} />
            </Pane>
            <Pane
              id={6}
              title="distancia-tierra"
              className="pane--wide"
              cmd={`soho --distancia tierra --rango ${range.label}`}
              label="Distancia de SOHO a la Tierra"
            >
              <Comment>miles de km · clic: mover la nave a ese instante</Comment>
              <DistanceChart samples={samples} selected={selected} onSelect={setSelected} />
            </Pane>

            <Pane id={7} title="datos.csv" className="pane--full" label="Datos en tabla">
              <details className="data-table">
                <summary>
                  <span className="prompt">$</span> cat datos.csv{' '}
                  <span className="comment-inline"># {dailyRows.length} filas, {range.rowLabel} · clic para expandir</span>
                </summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>fecha_utc</th>
                        <th>dist_sol_km</th>
                        <th>dist_tierra_km</th>
                        <th>y_l1_km</th>
                        <th>z_l1_km</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map((s) => (
                        <tr key={s.time.getTime()}>
                          <td>{fmtDateTime(s.time)}</td>
                          <td>{fmtInt(s.sunDistKm)}</td>
                          <td>{fmtInt(s.earthDistKm)}</td>
                          <td>{fmtInt(s.relL1[1])}</td>
                          <td>{fmtInt(s.relL1[2])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Pane>
          </>
        )}
      </div>
    </main>
  )
}
