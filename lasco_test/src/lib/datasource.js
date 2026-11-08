// Origen de los datos del panel, elegido al compilar:
// - con backend (`npm run dev` / `npm run build`): todo viene de lasco_backend vía `/api/lasco`;
// - estático (`npm run build:static`, VITE_DATA_SOURCE=static en `.env.static`): una foto de los datos generada con
//   `python -m app export` y copiada en `data/` junto al sitio (ver deploy/estatico.sh). Sin servidor ni «actualizar».

export const STATIC_DATA = import.meta.env.VITE_DATA_SOURCE === 'static'

// Relativa a la base del sitio: con `base: './'` funciona en la raíz o en una subcarpeta (usuario.github.io/repo/).
export const DATA_URL = `${import.meta.env.BASE_URL}data/`

class StaticDataError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

const cache = new Map() // nombre → Promise<JSON>

/**
 * JSON de la foto (`meta.json`, `images.json`, `positions/1d-15m.json`…), pedido una sola vez por visita.
 * `cache: 'no-cache'` revalida con el servidor (GitHub Pages cachea 10 min): tras un despliegue nuevo no se mezclan
 * JSON viejos con imágenes nuevas. Las JPG tienen nombre único y no lo necesitan.
 * Si falla, rechaza con `status` (404 si la foto no tiene ese archivo) y se puede volver a pedir.
 */
export function staticJson(name) {
  if (!cache.has(name)) {
    const p = fetch(DATA_URL + name, { cache: 'no-cache', signal: AbortSignal.timeout(20_000) }).then((res) => {
      if (!res.ok) throw new StaticDataError(`data/${name} respondió ${res.status}`, res.status)
      return res.json()
    })
    cache.set(name, p)
    p.catch(() => cache.delete(name))
  }
  return cache.get(name)
}
