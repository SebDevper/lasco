// Geometría del sistema Sol–Tierra–SOHO.
// Entrada: vectores heliocéntricos en el plano de la eclíptica (km, km/s).

export const AU_KM = 149_597_870.7
export const SUN_RADIUS_KM = 695_700

// Razón de masas (Tierra + Luna) / Sol. La distancia de L1 a la Tierra es ≈ r·(μ/3)^(1/3).
const MU = 3.04e-6
const L1_FACTOR = Math.cbrt(MU / 3)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a) => Math.hypot(a[0], a[1], a[2])
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a) => scale(a, 1 / norm(a))

/**
 * Sistema de referencia rotatorio ligado a la Tierra:
 *  x → del Sol hacia la Tierra, z → norte de la eclíptica, y → completa la terna (≈ sentido del movimiento orbital).
 */
export function rotatingFrame(earthPos) {
  const x = unit(earthPos)
  const zRaw = [0, 0, 1]
  const z = unit(sub(zRaw, scale(x, dot(zRaw, x))))
  const y = cross(z, x)
  return { x, y, z }
}

const toFrame = (v, f) => [dot(v, f.x), dot(v, f.y), dot(v, f.z)]

/** Métricas de un instante: todo lo que muestra el panel. */
export function describeSample({ time, soho, earth }) {
  const frame = rotatingFrame(earth.pos)
  const earthDist = norm(earth.pos)
  const l1Dist = earthDist * L1_FACTOR

  const relEarth = toFrame(sub(soho.pos, earth.pos), frame) // SOHO respecto a la Tierra
  const relL1 = [relEarth[0] + l1Dist, relEarth[1], relEarth[2]] // SOHO respecto a L1
  const lateral = Math.hypot(relEarth[1], relEarth[2]) // separación de la línea Sol–Tierra

  return {
    time,
    frame,
    earthPos: earth.pos,
    sohoPos: soho.pos,
    relEarth,
    relL1,
    l1Dist,
    sunDistKm: norm(soho.pos),
    earthDistKm: norm(sub(soho.pos, earth.pos)),
    earthSunDistKm: earthDist,
    lateralKm: lateral,
    // Ángulo Sol–Tierra–SOHO visto desde la Tierra
    sesAngleDeg: (Math.atan2(lateral, -relEarth[0]) * 180) / Math.PI,
    speedKms: norm(soho.vel),
    speedRelEarthKms: norm(sub(soho.vel, earth.vel)),
    eclipticLonDeg: ((Math.atan2(soho.pos[1], soho.pos[0]) * 180) / Math.PI + 360) % 360,
  }
}
