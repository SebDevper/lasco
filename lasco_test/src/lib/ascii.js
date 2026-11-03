// Filtro ASCII para la escena 3D: convierte cada cuadro renderizado en caracteres de texto.
//
// En cada cuadro se reduce la imagen del canvas WebGL a una grilla de cols × rows (una celda por carácter),
// se elige un carácter según el brillo de la celda y se dibuja con la fuente monoespaciada de la página.
// - 'ascii':       un solo color (verde fósforo); el brillo se ve en la densidad del carácter.
// - 'ascii-color': cada carácter con el color de su celda (el Sol ámbar, la imagen C3 azul, etc.).

// Rampa clásica de menor a mayor densidad de tinta: pocos niveles, pero sin caracteres "ruidosos" en los tonos
// tenues (las estrellas quedan como puntos).
const RAMP = ' .:-=+*#%@'
// Por debajo de esta luminancia la celda queda vacía (evita ruido en el fondo).
const BLACK_LEVEL = 0.05
const MONO_COLOR = '#3dff7a'

export function createAsciiLayer(container, { fontSize = 11, lineHeight = 12 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.className = 'scene-ascii'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.display = 'none'
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  // Reducción en dos pasos (×4 y luego a la grilla) para promediar mejor y no perder líneas finas.
  const mid = document.createElement('canvas')
  const midCtx = mid.getContext('2d')
  const grid = document.createElement('canvas')
  const gridCtx = grid.getContext('2d', { willReadFrequently: true })

  let mode = 'off'
  let width = 0
  let height = 0
  let cols = 0
  let rows = 0
  let cellW = fontSize * 0.6
  let dpr = 1
  let font = ''

  function measure() {
    const family = getComputedStyle(container).fontFamily || 'monospace'
    font = `${fontSize}px ${family}`
    ctx.font = font
    cellW = ctx.measureText('M').width || fontSize * 0.6
    cols = Math.max(1, Math.floor(width / cellW))
    rows = Math.max(1, Math.floor(height / lineHeight))
    grid.width = cols
    grid.height = rows
    mid.width = cols * 4
    mid.height = rows * 4
  }

  function resize(w, h) {
    width = w
    height = h
    dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    measure()
  }

  // Si la fuente web carga después, el ancho de carácter cambia: volver a medir.
  document.fonts?.ready.then(() => width && measure())

  function setMode(next) {
    mode = next
    canvas.style.display = mode === 'off' ? 'none' : 'block'
  }

  /** Dibuja en ASCII el contenido actual de `source` (el canvas WebGL, justo después de renderizar). */
  function render(source) {
    if (mode === 'off' || !cols) return
    midCtx.drawImage(source, 0, 0, mid.width, mid.height)
    gridCtx.drawImage(mid, 0, 0, cols, rows)
    const px = gridCtx.getImageData(0, 0, cols, rows).data

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.font = font
    ctx.textBaseline = 'top'

    const n = RAMP.length - 1
    const color = mode === 'ascii-color'
    if (!color) ctx.fillStyle = MONO_COLOR

    for (let y = 0; y < rows; y++) {
      let line = ''
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4
        const r = px[i]
        const g = px[i + 1]
        const b = px[i + 2]
        // Luminancia con una curva que realza los tonos oscuros (corona tenue, órbitas).
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        const l = Math.min(1, Math.pow(lum, 0.7) * 1.15)
        const ch = lum < BLACK_LEVEL ? ' ' : RAMP[Math.max(1, Math.round(l * n))]
        if (!color) {
          line += ch
        } else if (ch !== ' ') {
          // Mantener el tono del píxel, pero con brillo suficiente para leerse sobre negro.
          const k = (255 * (0.45 + 0.55 * l)) / Math.max(r, g, b, 1)
          ctx.fillStyle = `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`
          ctx.fillText(ch, x * cellW, y * lineHeight)
        }
      }
      if (!color) ctx.fillText(line, 0, y * lineHeight)
    }
  }

  return {
    resize,
    setMode,
    render,
    get active() {
      return mode !== 'off'
    },
    dispose() {
      canvas.remove()
    },
  }
}
