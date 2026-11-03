// Filtros de dibujo para la escena 3D: convierten cada cuadro renderizado en texto o en puntos.
//
// En cada cuadro se reduce la imagen del canvas WebGL a una grilla (una celda por carácter o por punto), se mide el
// brillo de cada celda y se dibuja sobre un canvas 2D encima del WebGL:
// - 'ascii':       caracteres en verde fósforo; el brillo se ve en la densidad del carácter.
// - 'ascii-color': caracteres con el color de su celda (el Sol ámbar, la imagen C3 azul, etc.).
// - 'stipple':     dibujo punteado: puntos verdes cuyo tamaño crece con el brillo, levemente desordenados.
// - 'stipple-color': el mismo punteado, con cada punto del color de su celda.

// Rampa clásica de menor a mayor densidad de tinta: pocos niveles, pero sin caracteres "ruidosos" en los tonos
// tenues (las estrellas quedan como puntos).
const RAMP = ' .:-=+*#%@'
// Por debajo de esta luminancia la celda queda vacía (evita ruido en el fondo).
const BLACK_LEVEL = 0.05
const INK = '#3dff7a'

// Punteado: tamaño de celda (px) y radio máximo del punto relativo a la celda. Con ≤ 0,5 los puntos no llegan a
// fundirse ni en las zonas más brillantes: siempre queda algo de negro entre ellos, como en un dibujo a puntos.
const STIPPLE_CELL = 5
const STIPPLE_MAX_R = 0.48
const STIPPLE_JITTER = 0.55

/** Luminancia de un píxel (0–1). */
const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** Desplazamiento pseudoaleatorio, fijo por celda, en [-0,5, 0,5): el punteado no tiembla entre cuadros. */
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s) - 0.5
}

export function createFilterLayer(container, { fontSize = 11, lineHeight = 12 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.className = 'scene-filter'
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
  let cellH = lineHeight
  let dpr = 1
  let font = ''
  let jitter = null // desplazamientos del punteado, [dx0, dy0, dx1, dy1, …] en px

  /** Tamaño de la grilla según el modo: celdas de un carácter (ASCII) o de STIPPLE_CELL px (punteado). */
  function measure() {
    if (!width) return
    if (mode.startsWith('stipple')) {
      cellW = cellH = STIPPLE_CELL
      cols = Math.max(1, Math.floor(width / cellW))
      rows = Math.max(1, Math.floor(height / cellH))
      jitter = new Float32Array(cols * rows * 2)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 2
          jitter[i] = hash(x, y) * cellW * STIPPLE_JITTER
          jitter[i + 1] = hash(y + 17.3, x + 5.1) * cellH * STIPPLE_JITTER
        }
      }
    } else {
      const family = getComputedStyle(container).fontFamily || 'monospace'
      font = `${fontSize}px ${family}`
      ctx.font = font
      cellW = ctx.measureText('M').width || fontSize * 0.6
      cellH = lineHeight
      cols = Math.max(1, Math.floor(width / cellW))
      rows = Math.max(1, Math.floor(height / cellH))
    }
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
  document.fonts?.ready.then(() => measure())

  function setMode(next) {
    if (next === mode) return
    mode = next
    canvas.style.display = mode === 'off' ? 'none' : 'block'
    measure()
  }

  /** Brillo y color de cada celda del cuadro actual de `source`. */
  function sampleGrid(source) {
    midCtx.drawImage(source, 0, 0, mid.width, mid.height)
    gridCtx.drawImage(mid, 0, 0, cols, rows)
    return gridCtx.getImageData(0, 0, cols, rows).data
  }

  function clear() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
  }

  function drawAscii(px, color) {
    ctx.font = font
    ctx.textBaseline = 'top'
    const n = RAMP.length - 1
    if (!color) ctx.fillStyle = INK

    for (let y = 0; y < rows; y++) {
      let line = ''
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4
        const r = px[i]
        const g = px[i + 1]
        const b = px[i + 2]
        // Luminancia con una curva que realza los tonos oscuros (corona tenue, órbitas).
        const lum = luminance(r, g, b)
        const l = Math.min(1, Math.pow(lum, 0.7) * 1.15)
        const ch = lum < BLACK_LEVEL ? ' ' : RAMP[Math.max(1, Math.round(l * n))]
        if (!color) {
          line += ch
        } else if (ch !== ' ') {
          // Mantener el tono del píxel, pero con brillo suficiente para leerse sobre negro.
          const [cr, cg, cb] = boosted(r, g, b, l)
          ctx.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`
          ctx.fillText(ch, x * cellW, y * cellH)
        }
      }
      if (!color) ctx.fillText(line, 0, y * cellH)
    }
  }

  /** Color de un píxel con brillo realzado para leerse sobre negro, conservando su tono. */
  function boosted(r, g, b, l) {
    const k = (255 * (0.45 + 0.55 * l)) / Math.max(r, g, b, 1)
    return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)]
  }

  function drawStipple(px, color) {
    // Los puntos se acumulan en trazados y se rellenan de una vez (mucho más rápido que punto por punto).
    // Monocromo: un solo trazado. Color: un trazado por tono, con los colores reducidos a 8 niveles por canal
    // (512 tonos como máximo, a simple vista igual que el color exacto).
    const paths = new Map() // tono → Path2D
    const single = color ? null : new Path2D()
    const maxR = cellW * STIPPLE_MAX_R
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = y * cols + x
        const i = c * 4
        const r0 = px[i]
        const g0 = px[i + 1]
        const b0 = px[i + 2]
        const lum = luminance(r0, g0, b0)
        if (lum < BLACK_LEVEL) continue
        // Área del punto proporcional al brillo (radio ∝ √brillo); curva suave para conservar los medios tonos.
        const l = Math.min(1, Math.pow(lum, 0.85))
        const rad = maxR * Math.sqrt(l)
        if (rad < 0.35) continue
        const cx = (x + 0.5) * cellW + jitter[c * 2]
        const cy = (y + 0.5) * cellH + jitter[c * 2 + 1]

        let path = single
        if (color) {
          const [r, g, b] = boosted(r0, g0, b0, l)
          const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
          path = paths.get(key)
          if (!path) paths.set(key, (path = new Path2D()))
        }
        path.moveTo(cx + rad, cy)
        path.arc(cx, cy, rad, 0, Math.PI * 2)
      }
    }
    if (!color) {
      ctx.fillStyle = INK
      ctx.fill(single)
      return
    }
    for (const [key, path] of paths) {
      // Centro de cada nivel (×32 + 16) para no oscurecer los tonos.
      ctx.fillStyle = `rgb(${((key >> 6) & 7) * 32 + 16},${((key >> 3) & 7) * 32 + 16},${(key & 7) * 32 + 16})`
      ctx.fill(path)
    }
  }

  /** Dibuja el contenido actual de `source` (el canvas WebGL, justo después de renderizar) con el filtro activo. */
  function render(source) {
    if (mode === 'off' || !cols) return
    const px = sampleGrid(source)
    clear()
    if (mode === 'stipple' || mode === 'stipple-color') drawStipple(px, mode === 'stipple-color')
    else drawAscii(px, mode === 'ascii-color')
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
