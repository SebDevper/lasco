/**
 * Ventana de terminal: barra de título con número de panel y nombre, línea de comando opcional y contenido.
 * `actions` se muestra a la derecha de la barra (botones de la ventana).
 */
export default function Pane({ id, title, cmd, actions, className = '', label, children }) {
  return (
    <section className={`pane ${className}`} aria-label={label ?? title}>
      <header className="pane__bar">
        <span className="pane__id">[{id}]</span>
        <h2 className="pane__title">{title}</h2>
        {actions && <div className="pane__actions">{actions}</div>}
      </header>
      <div className="pane__body">
        {cmd && (
          <div className="pane__cmd">
            <span className="prompt">$</span> {cmd}
          </div>
        )}
        {children}
      </div>
    </section>
  )
}

/** Comentario de terminal: "# texto" en color atenuado. */
export function Comment({ children, className = '' }) {
  return <p className={`comment ${className}`}># {children}</p>
}
