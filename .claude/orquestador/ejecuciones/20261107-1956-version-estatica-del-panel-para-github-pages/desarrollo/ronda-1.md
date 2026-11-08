# Desarrollo · ronda 1
origen: plan

## Cambios

### Backend
- `lasco_backend/app/payloads.py` (nuevo, T1): `iso(dt)` e `image_json(row, url_prefix="/api/files")`, sacados
  sin cambios de `main.py`. No importa `main.py` ni crea `Store`.
- `lasco_backend/app/main.py` (T1): importa `image_json`/`iso` de `payloads` (se quitaron `_iso`, `_image_json` y
  los imports que ya no usaba: `SIZES`, `from_ms`). La salida de la API no cambia (ver Verificación).
- `lasco_backend/app/store.py` (T2): lecturas nuevas con `self._lock`, sin tocar `_SCHEMA` ni la migración:
  `sample_images(inst, start, end, step_ms) -> {time_ms: image_id}` (solo instantes de esa malla),
  `images_by_ids(ids)` y `missing_headers(ids)`, las dos por lotes de 500 (`_BATCH`).
- `lasco_backend/app/export.py` (nuevo, T3): `Exporter` + `export(out)`. `EXPORT_RANGES = ((1, 15), (30, 360))`
  con el comentario de que van con `STATIC_RANGE_IDS`. Pasos del plan en orden: posiciones (`positions_window`; si
  no hay `days*1440/paso + 1` instantes → `ExportError`, código 1, no escribe nada), `Syncer(store).run` de 24 h
  (modo all) y 30 d (paso 360), selección (unión de `sample_images` en la malla de 30d y `list_images` de 24 h;
  instantes sin imagen → aviso; imágenes sin archivos en disco → aviso y fuera), encabezados (solo los que faltan,
  `CONCURRENCY` en paralelo, reintentos propios que incluyen `ET.ParseError`, `save_header`), eventos
  (`events_between` por tramos de 7 días sobre [inicio 30d − 6 h, fin + 6 h], unidos por `id`, ordenados por
  `start`), cobertura recortada a [inicio 30d, max(fin 24h, fin 30d)], escritura en `.{out}.tmp-PID` hermana con
  `os.link` (o `copy2`), `meta.json` al final, y reemplazo de `--out` (renombra el anterior a `.old-PID`, si falla
  lo restaura). Resumen por consola; código 0 / 2 (avisos) / 1 (fatal).
- `lasco_backend/app/__main__.py` (T3): subcomando `export [--out DIR]` (por defecto `lasco_backend/export`).
- `lasco_backend/.gitignore`, `lasco_backend/.dockerignore` (T4): `export/`.

### Front
- `lasco_test/.env.static` (nuevo), `package.json` (`build:static`), `vite.config.js` (`defineConfig(({ mode }) =>
  …)`, `base: './'` solo en modo static; proxies sin cambios) (T5).
- `lasco_test/src/lib/datasource.js` (nuevo, T5): `STATIC_DATA`, `DATA_URL`, `staticJson(nombre)` con promesa
  cacheada por módulo, `cache: 'no-cache'`, timeout 20 s; si falla rechaza con `status` y se puede volver a pedir.
- `lasco_test/src/lib/positions.js` (T6): rama estática `positions/${days}d-${step}m.json`; 404 → «la foto no tiene
  posiciones para este rango». El camino con backend quedó en `backendPositions()` sin cambios.
- `lasco_test/src/lib/lasco.js` (T7): `fetchBackendStatus` estático (`meta.json` + índice de `images.json`, fija
  `backendCoverage`, devuelve `{static: true, generatedAt, ephemerisEnd, counts, coverage, warnings, sync: {running:
  false}}`), `closestImage` con `nearest` sobre el índice, `prefetchFrames` con el índice recortado a ±6 h (lo que
  respondería `/images`), `fromBackend` con `DATA_URL + url`, `fetchImageHeader` de `headers.json`, `fetchEvents` de
  `events.json` filtrando por solapamiento y ordenando por `start`.
- `lasco_test/src/pages/Dashboard.jsx` (T8): `STATIC_RANGE_IDS = ['24h', '30d']` (comentario hacia
  `EXPORT_RANGES`), botonera con `SHOWN_RANGES`, estado inicial `STATIC_DATA ? '24h' : '180d'`, sin «actualizar» en
  estático, `StaticLine` (`[ok]`/`[!]` · `datos actualizados al <fmtDateTime(generatedAt)> · versión estática · <n>
  imágenes` · `<n> avisos`), textos de carga/error/efemérides/timelapse/`[info]` para la foto. El polling no corre
  (`sync.running` falso).
- `lasco_test/src/components/LascoImages.jsx` (T8): aviso «[!] la foto no tiene todos los eventos» en estático;
  créditos (ambos modos) con «posiciones jpl horizons (nasa/jpl)» (enlace) y la frase de cooperación ESA/NASA.
- `lasco_test/.gitignore`, `lasco_test/.dockerignore` (T9): `dist-static`.

### Script y documentación
- `deploy/estatico.sh` (nuevo, ejecutable, T9): `[--base RUTA]`, `--help`; comprueba `.venv` y `npm` (sugiere el
  PATH de nvm), exporta (2 → sigue con aviso, otro ≠ 0 → aborta), `build:static` (con `-- --base` si se indicó),
  copia `lasco_backend/export` a `dist-static/data`, crea `.nojekyll`, muestra tamaño y avisa >1 GB o archivos
  >100 MB. Se puede correr desde cualquier carpeta del repo (`git rev-parse --show-toplevel`).
- `CLAUDE.md`, `README.md`, `lasco_backend/README.md`, `deploy/README.md` (T10): sección «Versión estática»,
  comandos, estructura de `data/`, matices de «sin backend el panel no carga», `EXPORT_RANGES` ↔
  `STATIC_RANGE_IDS`, códigos de salida, aviso de no correr el export junto a un servidor sincronizando; en
  `deploy/README.md` la nota inicial y una fila en la tabla de archivos.

### Pequeños añadidos fuera de la letra del plan
- `lasco.js`: `source` de la imagen = `'foto estática'` en modo estático (antes la figura decía «fuente: backend»
  también en la foto). Es una cadena; el modo con backend no cambia.
- `_is_ours` acepta también una carpeta **vacía** como `--out` (no hay nada que borrar); cualquier otra carpeta sin
  `meta.json` de `lasco_backend export` se rechaza.
- `meta.ephemerisEnd`: `horizons.soho_ephemeris_end` (en caché, sin consulta extra); si JPL dice que las efemérides
  siguen después de ahora (`None`), se usa el `end` de las posiciones de 24h.

## Verificación

Todo contra una copia: `cp -cR lasco_backend/data <scratchpad>/data-copia` + `LASCO_DATA_DIR`. La base real no se
tocó.

- **T1, regresión de la API**: `TestClient` sobre la copia antes y después del cambio, para `/api/images` (rango del
  03-11, con y sin `instrument`), `/api/images/closest` (c3 y c2), `/api/status` (sin `sync`) y `header` 404: JSON
  iguales y cuerpos **idénticos byte a byte** (`cmp`).
- **T2**: `sample_images('c3', 2026-11-04 − 30 d, 2026-11-04, 21_600_000)` → 121 instantes (121 imágenes distintas;
  c2: 121 instantes, 76 imágenes); `images_by_ids` con 2.000 ids inexistentes → 0 (lotes OK).
- **T3, exportación real** (`python -m app export --out <scratch>/export`): código 0, 1 min 9 s, 32,2 MB.
  - estructura exacta; `positions/` solo `1d-15m.json` (97, minutos 00/15/30/45) y `30d-360m.json` (121, 00/06/12/18
    UTC); ambos **iguales** a `GET /api/positions` sobre la misma copia;
  - 346 imágenes (c2 151, c3 195), ninguna anterior a inicio 30d − 6 h, las 692 JPG existen; 24h: 79 c2 + 78 c3;
  - instantes de 30d con imagen a > 3 h: c2 47, c3 3 (huecos reales de LASCO; el panel muestra el aviso de hueco);
  - `headers.json`: 346 (pedidos 342, reutilizados 4, 0 fallidos); en la copia `headers` pasó de 7 a 349 filas;
  - `events.json`: 467 eventos, 0 repetidos, del 2026-10-08 16:12 al 2026-11-08 03:13, ordenados, `error: null`;
  - `meta.coverage` = [2026-10-09 00:00, 2026-11-08 03:45] en c2 y c3 (no arrastra los 180 d);
  - la copia conserva su historial de ~180 días (la retención normal solo borró del 06-05 al 10-05, porque el fin
    avanzó del 04-11 al 08-11);
  - **segunda ejecución**: 0 descargadas, 0 encabezados pedidos, `images/headers/events.json` idénticos (`cmp`), sin
    carpetas `.tmp`/`.old` sobrantes;
  - **seguridad**: `--out` con un archivo ajeno → código 1, carpeta intacta; con `meta.json` de otro generador →
    código 1; `--out` apuntando a un archivo → código 1;
  - **JPL caído** (simulado: `horizons._query` lanza `ConnectError` y caché de posiciones vacía) → código 1, la foto
    anterior queda igual (mismo md5 de `meta.json`).
  - `import app.export` no carga `app.main`.
- **Builds**: `npm run build` → `dist/index.html` con `/assets/…`, y el bundle normal no contiene los textos
  estáticos (Vite elimina las ramas con `STATIC_DATA` falso); `npm run build:static` → `./assets/…`;
  `deploy/estatico.sh --base /repo/` → `/repo/assets/…`.
- **`deploy/estatico.sh`** (desde `lasco_test/src`, con `LASCO_DATA_DIR` de la copia): código 0, 33 MB, `.nojekyll`,
  `data/` completo; `git status` no muestra `lasco_backend/export/` ni `lasco_test/dist-static/`.
- **Sitio estático en una subcarpeta** (`python3 -m http.server 4174` con `www/repo → dist-static`, backend apagado)
  y **en la raíz** (puerto 4175), con Chrome sin interfaz controlado por CDP:
  - 0 peticiones a `/api/`; los JSON y JPG salen de `/repo/data/…`; `events.json` y `headers.json` solo al pausar;
  - abre en **24h**, botonera **24h · 30d**, sin «actualizar»;
  - consola: `[ok] efemérides jpl horizons (foto estática) · último dato …`, `[ok] datos actualizados al 2026-11-08
    03:59 UTC · versión estática · 346 imágenes`, `[ok] timelapse: 97/97 instantes con imagen de la foto`; en 30d,
    121/121; alto de la consola constante (87,6 px) al cargar, durante «play» y en 30d;
  - en pausa: imagen de 1024 px, detalle FITS completo, eventos ±6 h; «ver» de una CME salta a 20:30 y dibuja el
    sector (2 svg, «◆ 1 cme en el campo»);
  - vista «lasco»: la imagen c2 se carga como textura y queda alineada con el Sol 3D (captura revisada);
  - créditos con JPL Horizons y la frase ESA/NASA; sin errores de JS;
  - solo el front sin `data/` → `[error] … la foto no tiene posiciones para este rango # no se encontraron los datos
    de la foto (data/positions/1d-15m.json)` + «reintentar».
- **Modo con backend**: `npm run build` + `vite preview --port 4176` + uvicorn en 8000 sobre la copia
  (`LASCO_SYNC_ON_START=0`): 4 pestañas, abre en **180d**, botón «actualizar», `[ok] backend lasco · … imágenes en
  disco · cubre …`, timelapse 721/721, «fuente: backend», mismas rutas `/api/lasco/…` que antes. No probé el
  `POST /api/sync` desde el botón (ese código no cambió).
- `cd lasco_backend && .venv/bin/python -c "import app.main"` OK.
- Limpieza: detuve los servidores que arranqué (4174, 4175, 4176, 8000) y Chrome; borré `lasco_backend/export/` y
  `lasco_test/dist-static/` generados en las pruebas. `lasco_test/dist/` quedó con el build normal nuevo. La copia de
  datos y los scripts de prueba quedan en el scratchpad
  (`/private/tmp/claude-501/-Users-abner-workspace-super-project/a225dcd6-b253-4331-a0e6-27d230b6b540/scratchpad/`:
  `data-copia/`, `export/`, `cdp/`, `verificar_export.py`, `api_snapshot.py`).
- No probé Docker (`docker compose build front`): solo agregué `dist-static/` y `export/` a los `.dockerignore`.

## Notas para el revisor / tester
- La copia `data-copia` del scratchpad ya tiene los ~350 encabezados y las imágenes hasta el 08-11: una exportación
  sobre ella es rápida. Para medir «la primera vez», clonar de nuevo `lasco_backend/data`.
- Los huecos de c2 en la malla de 30d (47 instantes con la imagen a > 3 h) no son avisos de `meta.json`: el plan solo
  pide aviso para instantes **sin** imagen; el panel marca esos instantes con el aviso de hueco, igual que en el modo
  con backend.
- `ephemerisEnd` de `meta.json` coincide con el fin de las posiciones de 24h cuando JPL dice que las efemérides
  siguen después de ahora (hoy es así). El panel muestra como «último dato» el `end` del archivo de posiciones, como
  en el modo con backend.
- En estático, la consola abre en 24h; las peticiones por visita son ~130 JPG de 512 px en 24h (varios instantes
  comparten imagen) más la de 1024 px al pausar.
- Al ejecutar `deploy/estatico.sh` sin `LASCO_DATA_DIR`, usa (y modifica) `lasco_backend/data`: es lo que se quiere en
  uso real, pero en pruebas hay que pasar la copia.
