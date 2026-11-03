import { useState } from 'react'
import Pane, { Comment } from './Pane.jsx'
import { EVENTS_WINDOW_H, INSTRUMENTS, cmeVisibleAt, isDataGap, useLascoDetails } from '../lib/lasco.js'
import { fmt1, fmtDateTime, fmtInt, fmtOffset } from '../lib/format.js'

// Campo interior aproximado (radios solares) si el encabezado aún no llegó.
const DEFAULT_INNER = { c2: 2.2, c3: 3.7 }
const COMPASS = ['n', 'ne', 'e', 'se', 's', 'so', 'o', 'no']

/** Ángulo de posición (grados desde el norte hacia el este) → punto cardinal. */
const compass = (pa) => COMPASS[Math.round((((pa % 360) + 360) % 360) / 45) % 8]

/** Aviso de hueco en los datos. Siempre se dibuja (reserva su espacio); solo se hace visible cuando `show`. */
export function GapBadge({ show }) {
  return (
    <strong className={`gap-badge ${show ? '' : 'is-hidden'}`} aria-hidden={!show}>
      [!] hueco en los datos de lasco
    </strong>
  )
}

/**
 * Sectores de las CME visibles en la imagen. Con el norte solar arriba, el ángulo de posición (AP) crece desde el
 * norte hacia el este, que en la imagen está a la izquierda: punto(r, AP) = (cx − r·sen AP, cy − r·cos AP).
 */
function CmeOverlay({ image, cmes, inner }) {
  if (!image || !cmes.length) return null
  const { width: W, height: H, centerX: cx, centerY: cy, rsunPx } = image
  const rIn = inner * rsunPx
  const rOut = Math.hypot(W, H) // más allá del borde: el SVG recorta
  const pt = (r, deg) => {
    const a = (deg * Math.PI) / 180
    return [cx - r * Math.sin(a), cy - r * Math.cos(a)]
  }
  const fontSize = W * 0.028

  return (
    <svg className="cme-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {cmes.map(({ cme, n }) => {
        const half = Math.max(cme.width, 4) / 2
        const a1 = cme.pa - half
        const a2 = cme.pa + half
        const large = cme.width > 180 ? 1 : 0
        const [x1, y1] = pt(rIn, a1)
        const [x2, y2] = pt(rOut, a1)
        const [x3, y3] = pt(rOut, a2)
        const [x4, y4] = pt(rIn, a2)
        // AP creciente = sentido antihorario en pantalla (sweep 0 en SVG).
        const d = `M${x1},${y1} L${x2},${y2} A${rOut},${rOut} 0 ${large} 0 ${x3},${y3} L${x4},${y4} A${rIn},${rIn} 0 ${large} 1 ${x1},${y1} Z`
        // Números a distancias escalonadas (5 anillos) para que CME cercanas no se encimen.
        const rLabel = Math.min(rIn * (1.45 + 0.32 * (n % 5)), Math.min(W, H) * 0.47)
        const [lx, ly] = pt(rLabel, cme.pa)
        return (
          <g key={cme.id}>
            <path className="cme-overlay__sector" d={d} />
            <text className="cme-overlay__label" x={lx} y={ly} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">
              {n}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Datos técnicos del encabezado FITS (alto fijo: 6 líneas, haya o no detalle). */
function FitsDetail({ header, paused, loading }) {
  let rows
  if (!paused) {
    rows = [['#', 'pausa el timelapse para ver el detalle de la imagen']]
  } else if (!header) {
    rows = [['#', loading ? 'consultando encabezado fits…' : 'encabezado fits no disponible']]
  } else {
    const flags = [
      header.quicklook ? 'quicklook (preliminar)' : 'calibrada',
      `${fmtInt(header.missingBlocks ?? 0)} bloques faltantes`,
      `${fmtInt(header.saturated ?? 0)} px saturados`,
    ]
    rows = [
      ['obs', `${header.observedAt ? fmtDateTime(new Date(header.observedAt)) : '—'} · exp ${fmt1(header.exposure ?? 0)} s`],
      ['filtro', `${(header.filter ?? '—').toLowerCase()} · polarizador ${(header.polarizer ?? '—').toLowerCase()}`],
      [
        'campo',
        `${fmt1(header.fieldInner ?? 0)}–${fmt1(header.fieldOuter ?? 0)} R☉ · ${fmt1(header.plateScale ?? 0)}″/px · binning ${header.binning}`,
      ],
      ['soho', `orientación ${fmt1(header.roll ?? 0)}° respecto del norte solar`],
      ['archivo', `${header.file ?? '—'} (${header.fileOrig ?? '—'})`],
      ['datos', flags.join(' · ')],
    ]
  }
  return (
    <dl className="fits-detail" aria-live="polite">
      <dt className="fits-detail__title"># detalle.fits</dt>
      {Array.from({ length: 6 }, (_, i) => rows[i] ?? ['', '']).map(([k, v], i) => (
        <div className="fits-detail__row" key={i} title={v || undefined}>
          <dt className={k === '#' ? 'comment-inline' : 'kv__key'}>{k}</dt>
          <dd className={k === '#' ? 'comment-inline' : ''}>{v || ' '}</dd>
        </div>
      ))}
    </dl>
  )
}

function LascoFigure({ id, image, time, onOpen, header, cmes, details }) {
  const [loadedUrl, setLoadedUrl] = useState(null)
  const inst = INSTRUMENTS[id]
  // Tras la primera imagen, no volver a ocultarla al cambiar de instante (evita parpadeos en el timelapse).
  const loaded = image && loadedUrl != null

  return (
    <figure className="lasco-figure">
      <figcaption className="lasco-figure__head">
        <span className="kv__key">{id}</span> <span className="comment-inline"># campo {inst.field}</span>
      </figcaption>
      <button
        className="lasco-figure__frame"
        onClick={() => onOpen(id)}
        disabled={!image}
        aria-label={`Ver ${inst.label} superpuesta desde la posición de SOHO`}
      >
        {image && (
          <img
            src={image.url}
            alt={`Corona solar vista por ${inst.label} el ${fmtDateTime(image.time)}`}
            onLoad={() => setLoadedUrl(image.url)}
            className={loaded ? 'is-loaded' : ''}
          />
        )}
        {details.paused && loaded && (
          <CmeOverlay image={image} cmes={cmes} inner={header?.fieldInner ?? DEFAULT_INNER[id]} />
        )}
        {details.paused && loaded && details.events && (
          <span className={`cme-count ${cmes.length ? 'cme-count--some' : ''}`}>
            {cmes.length
              ? `◆ ${cmes.length} cme en el campo`
              : '# sin cme en el campo en este instante'}
          </span>
        )}
        {!loaded && (
          <span className="lasco-figure__loading">
            cargando imagen<span className="cursor cursor--inline" />
          </span>
        )}
        <span className="lasco-figure__cta">[ ver desde soho ]</span>
      </button>
      <div className="lasco-figure__meta">
        {/* Alto fijo (dos líneas): el aviso de hueco siempre ocupa su lugar, aunque esté oculto, para que
            el panel no cambie de tamaño al reproducir el timelapse. */}
        <div
          className="lasco-figure__line"
          title={image ? `${fmtDateTime(image.time)} · ${fmtOffset(image.time, time)} · fuente: ${image.source}` : undefined}
        >
          {image ? (
            <>
              <span className="kv__key">t =</span> {fmtDateTime(image.time)}{' '}
              <span className="comment-inline">
                # {fmtOffset(image.time, time)} del instante seleccionado · fuente: {image.source}
              </span>
            </>
          ) : (
            ' '
          )}
        </div>
        <div className="lasco-figure__line">
          <GapBadge show={Boolean(image) && isDataGap(image, time)} />
        </div>
      </div>
      <FitsDetail header={header} paused={details.paused} loading={details.loading} />
    </figure>
  )
}

const fmtShort = (d) => fmtDateTime(d).replace(' UTC', '')

/** Duración legible: "45 min", "3 h 10 min", "2 d 4 h". */
function fmtDuration(ms) {
  const min = Math.round(Math.abs(ms) / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

const MARGIN = 15 * 60_000 // mismo margen que cmeVisibleAt

/**
 * Índice del instante de la línea de tiempo más cercano al centro de la ventana en que la CME estuvo en el campo
 * (o null si ningún instante cae dentro: p. ej., rangos largos con pasos de 6 h).
 */
function jumpIndex(timeline, cme) {
  const a = cme.start.getTime() - MARGIN
  const b = cme.end.getTime() + MARGIN
  const mid = (a + b) / 2
  let best = null
  timeline.forEach((t, i) => {
    const ms = t.getTime()
    if (ms >= a && ms <= b && (best == null || Math.abs(ms - mid) < Math.abs(timeline[best].getTime() - mid))) best = i
  })
  return best
}

/** Estado de la CME respecto del instante seleccionado: en la imagen, aún no aparece o ya salió. */
function cmeState(cme, visible, time) {
  if (visible) return <span className="tag tag--ok"> ◆ en la imagen</span>
  const t = time.getTime()
  if (t < cme.start.getTime()) return <span className="comment-inline"> · aparece en {fmtDuration(cme.start - t)}</span>
  return <span className="comment-inline"> · salió del campo hace {fmtDuration(t - cme.end)}</span>
}

/** Registro de eventos solares alrededor del instante (alto fijo con scroll). */
function EventsLog({ details, numbered, visibleIds, time, timeline, onJump }) {
  let body
  if (!details.paused) {
    body = <li className="comment-inline"># pausa el timelapse para ver los eventos solares de ese momento</li>
  } else if (!details.events) {
    body = (
      <li className={details.loading ? 'comment-inline' : ''}>
        {details.loading ? (
          '# consultando el hek…'
        ) : (
          <>
            <span className="tag tag--error">[error]</span> eventos no disponibles: {details.eventsError}
          </>
        )}
      </li>
    )
  } else if (!details.events.length) {
    body = <li className="comment-inline"># sin cme ni fulguraciones registradas en esta ventana</li>
  } else {
    body = details.events.map((e) =>
      e.type === 'cme' ? (
        <li key={e.id} className={visibleIds.has(e.id) ? 'is-visible' : ''}>
          {(() => {
            const visible = visibleIds.has(e.id)
            const jump = visible ? null : jumpIndex(timeline, e)
            return (
              <>
                {jump != null ? (
                  <button
                    className="btn btn--small event-jump"
                    onClick={() => onJump(jump)}
                    title="Mover la línea de tiempo al instante en que esta CME estaba en el campo de LASCO"
                  >
                    ver
                  </button>
                ) : (
                  <span className="event-jump event-jump--placeholder" aria-hidden="true" />
                )}{' '}
                <span className="tag tag--warn">[cme {numbered.get(e.id)}]</span> {fmtShort(e.start)} →{' '}
                {fmtShort(e.end)} · <strong>{fmtInt(e.speed)} km/s</strong> · ancho {fmtInt(e.width)}° · ap{' '}
                {fmtInt(e.pa)}° ({compass(e.pa)})<span className="comment-inline"> · {e.catalog.toLowerCase()}</span>
                {cmeState(e, visible, time)}
              </>
            )
          })()}
        </li>
      ) : (
        <li key={e.id} className={/^[MX]/.test(e.goesClass) ? 'is-strong' : ''}>
          <span className="event-jump event-jump--placeholder" aria-hidden="true" />{' '}
          <span className="tag tag--info">[fulguración]</span> <strong>{e.goesClass}</strong> · pico{' '}
          {fmtShort(e.peak ?? e.start)}
          {e.ar ? ` · región activa ${e.ar}` : ''}
          {e.hpcX != null ? ` · disco ${e.hpcY >= 0 ? 'n' : 's'}${e.hpcX >= 0 ? 'o' : 'e'}` : ''}
          <span className="comment-inline"> · {e.catalog.toLowerCase()}</span>
        </li>
      ),
    )
  }
  return (
    <div className="events-log">
      <div className="events-log__head">
        <span className="prompt">$</span> hek --eventos cme,fulguraciones --ventana ±{EVENTS_WINDOW_H}h{' '}
        <span className="comment-inline">
          # cme: cactus (detección automática en lasco) · fulguraciones: goes/noaa · ◆ = sector dibujado en la imagen ·
          [ver]: ir al instante en que la cme estaba en el campo
        </span>
        {details.paused && details.eventsError && details.events && (
          <span className="tag tag--warn"> [!] hek no respondió: mostrando caché</span>
        )}
      </div>
      <ul className="events-log__list">{body}</ul>
    </div>
  )
}

/** Imágenes LASCO C2 y C3 más cercanas al instante seleccionado, con su detalle al pausar. */
export default function LascoImages({ lasco, time, onOpen, paused, timeline, onJump }) {
  const details = useLascoDetails(lasco, time, paused)

  // CME del registro numeradas en orden; se dibujan en cada imagen las que estaban en el campo al tomarla.
  const cmes = details.paused && details.events ? details.events.filter((e) => e.type === 'cme') : []
  const numbered = new Map(cmes.map((c, i) => [c.id, i + 1]))
  const visibleIn = (image) =>
    image ? cmes.filter((c) => cmeVisibleAt(c, image.time.getTime())).map((cme) => ({ cme, n: numbered.get(cme.id) })) : []
  const inC2 = visibleIn(lasco.c2)
  const inC3 = visibleIn(lasco.c3)
  const visibleIds = new Set([...inC2, ...inC3].map(({ cme }) => cme.id))

  return (
    <Pane
      id={4}
      title="lasco · imagenes"
      className="pane--full"
      label="Imágenes de LASCO"
      cmd={`lasco --imagenes --cercanas-a "${fmtDateTime(time)}"${paused ? ' --detalle' : ''}`}
      actions={lasco.loading && <span className="tag tag--info">[..] actualizando</span>}
    >
      <Comment>
        lo que veía lasco en ese instante · clic en una imagen para verla superpuesta desde soho · en pausa: detalle y
        eventos
      </Comment>
      {lasco.error && !lasco.c2 ? (
        <p>
          <span className="tag tag--error">[error]</span> no se pudieron cargar las imágenes: {lasco.error}
        </p>
      ) : (
        <div className={`lasco-grid ${lasco.loading ? 'is-refreshing' : ''}`}>
          <LascoFigure
            id="c2"
            image={lasco.c2}
            time={time}
            onOpen={onOpen}
            header={details.paused ? details.headers?.c2 : null}
            cmes={inC2}
            details={details}
          />
          <LascoFigure
            id="c3"
            image={lasco.c3}
            time={time}
            onOpen={onOpen}
            header={details.paused ? details.headers?.c3 : null}
            cmes={inC3}
            details={details}
          />
        </div>
      )}
      <EventsLog
        details={details}
        numbered={numbered}
        visibleIds={visibleIds}
        time={time}
        timeline={timeline}
        onJump={onJump}
      />
      <p className="comment credit">
        # fuentes: imágenes SOHO/LASCO (ESA y NASA) vía{' '}
        <a href="https://helioviewer.org" target="_blank" rel="noreferrer">
          helioviewer.org
        </a>{' '}
        · eventos{' '}
        <a href="https://www.lmsal.com/hek/" target="_blank" rel="noreferrer">
          hek (lmsal)
        </a>
        , cme de{' '}
        <a href="https://www.sidc.be/cactus/" target="_blank" rel="noreferrer">
          cactus (sidc)
        </a>
      </p>
    </Pane>
  )
}
