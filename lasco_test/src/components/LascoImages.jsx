import { useState } from 'react'
import Pane, { Comment } from './Pane.jsx'
import { INSTRUMENTS, isDataGap } from '../lib/lasco.js'
import { fmtDateTime, fmtOffset } from '../lib/format.js'

/** Aviso de hueco en los datos. Siempre se dibuja (reserva su espacio); solo se hace visible cuando `show`. */
export function GapBadge({ show }) {
  return (
    <strong className={`gap-badge ${show ? '' : 'is-hidden'}`} aria-hidden={!show}>
      [!] hueco en los datos de lasco
    </strong>
  )
}

function LascoFigure({ id, image, time, onOpen }) {
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
    </figure>
  )
}

/** Imágenes LASCO C2 y C3 más cercanas al instante seleccionado. */
export default function LascoImages({ lasco, time, onOpen }) {
  return (
    <Pane
      id={4}
      title="lasco · imagenes"
      className="pane--full"
      label="Imágenes de LASCO"
      cmd={`lasco --imagenes --cercanas-a "${fmtDateTime(time)}"`}
      actions={lasco.loading && <span className="tag tag--info">[..] actualizando</span>}
    >
      <Comment>lo que veía lasco en ese instante · clic en una imagen para verla superpuesta desde soho</Comment>
      {lasco.error && !lasco.c2 ? (
        <p>
          <span className="tag tag--error">[error]</span> no se pudieron cargar las imágenes: {lasco.error}
        </p>
      ) : (
        <div className={`lasco-grid ${lasco.loading ? 'is-refreshing' : ''}`}>
          <LascoFigure id="c2" image={lasco.c2} time={time} onOpen={onOpen} />
          <LascoFigure id="c3" image={lasco.c3} time={time} onOpen={onOpen} />
        </div>
      )}
      <p className="comment credit">
        # fuente: SOHO/LASCO (ESA y NASA) vía{' '}
        <a href="https://helioviewer.org" target="_blank" rel="noreferrer">
          helioviewer.org
        </a>
      </p>
    </Pane>
  )
}
