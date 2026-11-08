# Revisión · ronda 2
veredicto: APROBADO

## Comentarios de la ronda anterior
- #1 — resuelto. En estático, `Dashboard.jsx` muestra `[carga] imágenes lasco desde la foto` y «la foto no tiene
  posiciones para ese rango». En el modo con backend se renderiza el mismo texto que antes: `desde` + `backend`
  con los mismos espacios, y «el backend no devolvió posiciones para ese rango». El bundle normal no contiene
  «la foto» (0 apariciones).
- #2 — resuelto. `StaticLine` agrega `reintentar` (`btn btn--small`, el mismo estilo que el reintento de las
  efemérides) en la misma línea del `[error]`, así que no suma líneas a la consola. `onRetry` pone `backend` en
  `undefined`, con lo que la línea pasa a `[..] leyendo la foto`, y sube `reloadKey`. Las posiciones salen de la
  caché de `staticJson` y `meta.json`/`images.json` se vuelven a pedir, porque las dos cachés olvidan la promesa
  que falló. `syncPending` sigue en falso, así que no hay `POST /api/sync`. El modo con backend recibe `onRetry`
  pero no lo usa: `BackendLine` sin `STATIC_DATA` no cambia.
- #3 — resuelto. `EVENTS_MARGIN = timedelta(hours=7)` con un comentario que explica el redondeo a la hora más
  cercana. `lasco_backend/README.md` también se actualizó (paso 5).
- #4 — resuelto. `.export.*` está en `lasco_backend/.gitignore` y en `.dockerignore`: `git check-ignore` atribuye
  `.export.tmp-1` y `.export.old-2` a `.gitignore:5`. `export()` atrapa `OSError` y responde
  `[error] exportación cancelada: error de archivos: …` con código 1; el traceback solo sale en el log de
  depuración. Lo probé con `_write` hacia una carpeta `chmod 555` del scratchpad: lanza `OSError` y no deja restos.
  `httpx.HTTPError` no hereda de `OSError`, así que los fallos de red siguen por su camino de siempre (avisos o
  `ExportError`).

## Comentarios nuevos
Ninguno.

## Revisado sin observaciones
- `npm run build` y `npm run build:static`: los dos compilan (salida en el scratchpad, ya borrada).
- `import app.main, app.export, app.__main__` funciona con `LASCO_DATA_DIR` temporal.
- El resto del cambio de la ronda 1 sigue igual: solo cambiaron `Dashboard.jsx`, `export.py`, los dos
  `.gitignore`/`.dockerignore` del backend y `lasco_backend/README.md`.
