# Revisión · ronda 1
veredicto: APROBADO

Base `3167375`. Revisé el diff completo (`git diff <base>`), los archivos nuevos (`export.py`, `payloads.py`,
`datasource.js`, `.env.static`, `deploy/estatico.sh`) y leí enteros `export.py`, `lasco.js`, `positions.js`, las
partes tocadas de `Dashboard.jsx`/`LascoImages.jsx`, `store.py`, `sync.py` (`run`, `_prune`, `_mark_coverage`),
`positions.py` (`positions_window`), `events.py` y los endpoints de `main.py` que replica la foto. No queda nada
bloqueante ni importante; los cuatro comentarios son menores y opcionales.

## Comentarios nuevos

### #1 [menor] `lasco_test/src/pages/Dashboard.jsx:388` — «desde backend» en la versión estática
Mientras se precargan las JPG (en cada visita y en cada cambio de pestaña, ~1 s en 24h), la consola de la foto dice
`[carga] imágenes lasco desde backend`. Es la única línea visible de la consola que no se adaptó (las de timelapse,
`[info]`, efemérides y errores sí). Esperado: `… desde la foto` con `STATIC_DATA`, como en la línea 400. En la misma
línea de cosas, `Dashboard.jsx:240` («el backend no devolvió posiciones para ese rango») en la práctica no se alcanza
en estático (el exportador garantiza todas las muestras), pero podría decir «la foto» por consistencia.

### #2 [menor] `lasco_test/src/pages/Dashboard.jsx:80-86` — sin forma de reintentar si falla `meta.json`/`images.json`
En el modo con backend, si `/status` falla, «actualizar» sirve de reintento. En la foto no hay botón: si
`meta.json` o `images.json` fallan por un corte de red momentáneo (o el timeout de 20 s en un móvil lento), queda
`[error] no se pudo leer la foto` sin imágenes y la única salida es cambiar de pestaña o recargar la página
(`staticJson` sí borra la promesa fallida, así que un reintento funcionaría). Sugerencia: un `reintentar`
(`btn btn--small`, como el de las efemérides, que hace `setReloadKey`) o al menos el comentario `# recarga la página`.

### #3 [menor] `lasco_backend/app/export.py:53-54` — el margen de eventos (6 h) es menor que la ventana que pide el panel
`useLascoDetails` (`lasco.js:376-381`) redondea el instante a la hora **más cercana** y pide ±6 h, así que para los
últimos instantes de la ventana de 24h el fin pedido llega hasta `photo_end + 6 h 30 min` (p. ej. fin 03:30 →
hora 04:00 → hasta 10:00). La foto solo trae eventos que se solapan con `[…, photo_end + 6 h]`: una fulguración que
empiece entre +6 h y +6 h 30 min no aparece en la foto y sí en el modo con backend. Solo se nota cuando el fin de
las efemérides va atrasado respecto de ahora. Arreglo trivial: `EVENTS_MARGIN = timedelta(hours=7)` (o
`EVENTS_WINDOW_H + 1`, con el comentario de por qué).

### #4 [menor] `lasco_backend/app/export.py:289-290` y `lasco_backend/.gitignore` — restos de una exportación interrumpida
Si el proceso muere sin pasar por el `except BaseException` (SIGKILL, cierre de la terminal con `kill -9`, corte
de luz) quedan `lasco_backend/.export.tmp-<pid>/` o `.export.old-<pid>/` (~32 MB). No están en `.gitignore` (solo
`export/`), así que aparecen en `git status` y nadie los limpia (el `rmtree` inicial solo borra el del mismo PID).
Sugerencia: agregar `.export.*` a `lasco_backend/.gitignore` (y `.dockerignore`, aunque el Dockerfile solo copia
`app/`). Relacionado y también opcional: `export()` (`export.py:333-337`) solo atrapa `ExportError`; un `OSError` al
escribir (disco lleno, sin permisos en el padre de `--out`) sale con traceback. El código de salida es 1 igual y
`estatico.sh` aborta bien, así que es solo presentación (`[error] exportación cancelada: …`).

## Añadidos fuera del plan (ronda-1.md)

Los tres se aceptan:
- `source: 'foto estática'`: solo se muestra en el título/comentario de la figura (`LascoImages.jsx:152,158`);
  ningún código compara `source`. El modo con backend sigue con `'backend'`.
- `_is_ours` acepta una carpeta vacía: no hay nada que perder; comprobé que `/`, `~`, la carpeta de datos,
  `data/images` y `meta.json` como ruta dan `False`, y que un `--out` que es un enlace simbólico a una foto anterior
  se reemplaza en el destino y el enlace sigue valiendo.
- `meta.ephemerisEnd` con caída al `end` de 24h cuando JPL dice que hay efemérides después de ahora: es
  informativo (el panel muestra el `end` del archivo de posiciones, como el modo con backend) y no hace consultas.

## Revisado sin observaciones

- **Plan**: T1–T10 cumplidas con sus criterios; nada fuera de alcance (no se tocaron proxies, nginx, compose, Caddy,
  retención ni validaciones de la API).
- **Modo con backend igual**: `image_json`/`iso` son un traslado literal (`main.py` ya no usa `SIZES`/`from_ms`);
  `toCoverage` es la misma lógica; `backendPositions` igual; 4 rangos, `INITIAL_RANGE = '180d'`, «actualizar» y
  `BackendLine` intactos; el único cambio visible son los créditos (previsto). El bundle normal no contiene los
  textos de la foto (`npm run build` en el scratchpad: `/assets/…`, 0 apariciones de «foto»).
- **Exportador** (ejecutado con `LASCO_DATA_DIR` sobre una copia en el scratchpad, nunca `lasco_backend/data`):
  código 0, 32,2 MB, estructura exacta, 97 + 121 instantes, 346 imágenes, 346 encabezados reutilizados y 0 pedidos
  en la segunda pasada, 0 descargas. `_is_ours` se comprueba antes de sincronizar y otra vez antes de reemplazar;
  temporal hermano + `meta.json` al final + restauración de la foto anterior si falla el `rename`. Los enlaces duros
  no corren riesgo: `save_image` escribe con `tmp.replace` (inodo nuevo) y `prune` hace `unlink`; `estatico.sh`
  copia (no enlaza) a `dist-static/data`. No importa `main.py`; `python -m app sync` sigue igual.
- **Base**: el exportador usa `Syncer.run` igual que «actualizar» (24 h en modo `all`, 30 d con paso 360 en la malla
  de `floor_to_step`), por lo que la retención y la cobertura se comportan como siempre; solo lecturas nuevas en
  `Store` (con `_lock`, por lotes de 500), sin tocar esquema ni migración.
- **`EXPORT_RANGES` ↔ `STATIC_RANGE_IDS`**: `(1, 15)`/`(30, 360)` ↔ `24h`/`30d` (`days`/`stepMinutes` de `RANGES` dan
  `1d-15m.json`/`30d-360m.json`); comentados en ambos lados y en `CLAUDE.md`. La selección por `sample_images`
  sobre la malla fija y la cobertura recortada a `[inicio 30d, max(fin 24h, fin 30d)]` son correctas; las mallas de
  90d/180d de la base coinciden con la de 30d (múltiplos de 6 h UTC).
- **Sin `/api` en estático**: todas las ramas con `STATIC_DATA` son constantes de compilación; el único `/api/lasco`
  que queda en el bundle estático es código muerto (`requestBackendSync`, `syncPending` nunca se activa sin el
  botón; el polling no corre porque `sync.running` es falso). `base: './'` → `DATA_URL = './data/'`, sin rutas
  absolutas en `index.html`, CSS ni JS (`npm run build:static` en el scratchpad: `./assets/…`).
- **Paridad con la API**: `headers.json` guarda lo mismo que `/images/{id}/header`; `events.json` sale de
  `list_events` y el front filtra con el mismo solapamiento (`end` nunca es nulo en `events`); `prefetchFrames` usa
  el índice con el mismo margen de ±6 h y `nearest`; `closestImage` y `fetchImageHeader` rechazan con mensajes en
  español; cachés por módulo que se limpian al fallar.
- **Layout y tono**: la consola sigue teniendo como mucho 4 líneas en estático; `StaticLine` con `[ok]`/`[!]`,
  `fmtDateTime`, «versión estática», avisos en singular/plural; la fila de rango no cambia de alto durante el uso
  (el botón no existe en ese build, no aparece/desaparece).
- **`deploy/estatico.sh`**: `set -euo pipefail`, `bash -n` OK, `${2:?}` para `--base` sin valor, captura del código
  de salida con `|| code=$?` (0 sigue, 2 avisa, otro aborta), rutas absolutas desde `git rev-parse` (igual que
  `subir.sh`), `rm -rf` solo de `$SITE/data`, `.nojekyll`, límites de 1 GB/100 MB con `du -sk`/`find -size`.
  Ejecutable. `lasco_backend/export/` y `lasco_test/dist-static/` ignorados en git y Docker; `.env.static` no se
  carga en el build de Docker (modo `production`).
- **Documentación**: `CLAUDE.md` (comandos, sección «Versión estática», matiz de «sin backend el panel no carga»,
  rangos), `README.md` (enlace del `deploy/README.md` coincide con el ancla de GitHub), `lasco_backend/README.md`
  (pasos, códigos de salida, advertencia de no correrlo junto a un servidor) y `deploy/README.md` son ciertos.
