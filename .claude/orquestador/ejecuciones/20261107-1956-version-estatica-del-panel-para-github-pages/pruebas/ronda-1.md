# Pruebas · ronda 1
veredicto: APROBADO

Todas las exportaciones se hicieron sobre una copia (`cp -cR lasco_backend/data` → `mktemp -d`, `LASCO_DATA_DIR`).
La base real no cambió: el md5 de `lasco.sqlite3` y la cantidad de archivos (6940) son los mismos antes y después
(`md5-data-real-antes.txt`).

## Casos
| # | caso | cómo | esperado | obtenido | resultado |
|---|---|---|---|---|---|
| 1 | primera exportación (copia recién clonada, 7 encabezados) | `python -m app export --out <tmp>/export` (`export-1.log`) | código 0/2, resumen | código 0 en 1 min 4 s, 32,2 MB. Resumen completo: 181 imágenes descargadas, 342 encabezados pedidos, 4 reutilizados, 0 fallidos, 467 eventos | ok |
| 2 | estructura y `meta.json` | `verificar_export.py` | exactamente la estructura del plan, `format: 1`, 2 rangos | `events/headers/images/images.json/meta/positions`; `positions/` solo `1d-15m` y `30d-360m`; `images/` solo c2 y c3; rangos 1d/15 y 30d/360; `generatedAt` = momento de la exportación | ok |
| 3 | posiciones | conteo, alineación y comparación con `GET /api/positions` (uvicorn en 8001 sobre la copia) | 97 (min 00/15/30/45) y 121 (00/06/12/18 UTC), iguales a la API | 97 y 121, alineadas y regulares; las dos **iguales** a la API | ok |
| 4 | imágenes | `verificar_export.py` | urls existen; ninguna anterior a inicio 30d − 6 h; 24h completo; ~340 en total | 346 (c2 151, c3 195); en 24h c2 79 y c3 78; 692 JPG, todas referenciadas, ninguna sobrante; la primera es del 2026-10-09 00:00; JPG con `os.link` (mismo inodo, 2 enlaces) | ok |
| 5 | huecos en la malla de 30d | imagen más cercana a cada instante | < 3 h o aviso | c2: 47 instantes a > 3 h, c3: 3. En la base **no hay ninguna** imagen c2 más cerca (hueco real del 15 al 17-10 y otros), así que no es un fallo de selección. No van a `warnings` porque tienen imagen (criterio del desarrollador, ronda 1). El panel muestra el aviso de hueco | ok |
| 6 | cobertura | `meta.coverage` | empieza en el inicio de 30d | c2 y c3 `[2026-10-09 00:00, 2026-11-08 04:15]` (la base tiene desde 2026-05-10) | ok |
| 7 | encabezados | `headers.json` y base de la copia | uno por imagen; tabla `headers` 7 → ~340 | 346 entradas = 346 imágenes; tabla 7 → 349 | ok |
| 8 | eventos | `events.json` | ~32 días, sin ids repetidos | 467 sin repetir, ordenados, del 2026-10-08 16:12 al 2026-11-08 03:13, `error: null`, cme + flare | ok |
| 9 | tamaño | `du -sh` | 30–40 MB | 32 MB (sitio completo 33 MB) | ok |
| 10 | la copia conserva sus 180 días | `min(time_ms)` de `images` | no borra más que una sincronización normal | sigue desde 2026-05-10 (c2 1968, c3 1631) | ok |
| 11 | segunda exportación seguida | otra vez con el mismo `--out` (`export-2.log`) | 0 descargas, 0 encabezados, misma foto | 2,8 s; 0 descargadas, 0 pedidos, 346 reutilizados; `images/headers/events.json` y las dos posiciones idénticas byte a byte (`cmp`); en `meta.json` solo cambia `generatedAt`; no quedan `.export.tmp`/`.old` | ok |
| 12 | `--out` con un archivo ajeno | carpeta con `tesis.txt` | código 1, intacta | `[error] exportación cancelada: … no es una exportación anterior … no se toca`, código 1, archivo intacto | ok |
| 13 | `--out` con `meta.json` de otro generador | | código 1 | código 1, `meta.json` intacto | ok |
| 14 | `--out` apuntando a un archivo | | código 1 | código 1, archivo intacto | ok |
| 15 | `--out` vacía o inexistente (anidada) | | se escribe | código 0 en los dos casos (crea `no/existe/foto`) | ok |
| 16 | JPL caído y sin posiciones guardadas | otra copia con `positions` vacía + `HTTPS_PROXY` a un puerto cerrado, `--out` = foto anterior | código 1, no reemplaza | `[error] … no se pudieron obtener las posiciones de 1d cada 15 min: HorizonsError(…)`, código 1, md5 de `meta.json` igual | ok |
| 17 | sin red con posiciones guardadas | otra copia + proxy a un puerto cerrado | código 2 con avisos | código 2, se escribe la foto, `warnings: ["sincronización 1d: no se pudo consultar Helioviewer"]` | ok (ver O1, O2) |
| 18 | regresión de la API (T1) | `TestClient` con el `app/` de `HEAD` (`git archive`) contra el actual, misma copia (`api_snapshot.py`) | byte a byte igual | `images` (con y sin `instrument`), `closest` c2/c3, `status` sin `sync`, `header` 404 y `images` 422: **idénticos** (`cmp`) | ok |
| 19 | API en vivo | curl a uvicorn en 8000 | 200 / 404 | `images` 200, `closest` 200, `status` 200, `header` existente 200, inexistente 404, id raro 404 | ok |
| 20 | `deploy/estatico.sh --help` / opción desconocida / `--base` sin valor / sin npm | | ayuda 0; resto 1 sin tocar nada | 0; `[error] opción desconocida`, 1; `--base necesita una ruta`, 1; `[error] no se encontró npm. Con nvm: …`, 1, y no se llegó a exportar | ok |
| 21 | `deploy/estatico.sh` sin `--base`, lanzado desde `lasco_test/src` | `LASCO_DATA_DIR=<copia>` (`estatico-1.log`) | `dist-static/` autocontenido, `./assets` | código 0, 33 MB, `.nojekyll`, `data/` completo, `index.html` con `./assets/…` | ok |
| 22 | `deploy/estatico.sh --base=/repo/` | (`estatico-2.log`) | `/repo/assets/…` | código 0, `index.html` con `/repo/assets/…`, exportación incremental (0 descargas, 0 encabezados) | ok |
| 23 | git ignora lo generado | `git status --ignored`, `check-ignore` | no aparecen | `lasco_backend/export/` y `lasco_test/dist-static/` solo como `!!` (`.gitignore:4` y `:3`) | ok |
| 24 | `npm run build` (modo normal) | | `dist/` con `/assets/…`, sin textos estáticos | OK, `/assets/…`, «la foto» 0 veces en el bundle | ok |
| 25 | estático en subcarpeta `/repo/` (base relativa), backend apagado | `http.server` 4173, Chrome | abre en 24h, solo 24h·30d, sin «actualizar», fecha de la foto | `[ok] efemérides jpl horizons (foto estática) · último dato 2026-11-08 04:15 UTC`, `[ok] datos actualizados al 2026-11-08 04:24 UTC · versión estática · 346 imágenes`, `[ok] timelapse: 97/97 instantes con imagen de la foto`. Botones 24h (activo) y 30d | ok |
| 26 | 0 peticiones a `/api` | Resource Timing + log del servidor | 0 | 0 de 140 recursos; JSON y JPG salen de `/repo/data/…`; fuera del origen solo Google Fonts; el único 404 es `/favicon.ico` (O3) | ok |
| 27 | detalle en pausa | texto de la página | 1024 px, FITS de 6 líneas, eventos ±6 h | imágenes `…_1024.jpg` (1024 px), `# detalle.fits` con 6 líneas en c2 y c3, 2 CME + 8 fulguraciones, «fuente: foto estática», créditos con JPL Horizons y la frase ESA/NASA | ok |
| 28 | CME «ver» | clic en `ver` de la cme 1 | salta al instante y dibuja el sector | t = 2026-11-07 20:30 UTC, «◆ 1 cme en el campo» en c2 y c3 con el sector dibujado (`estatico-repo-cme.jpg`) | ok |
| 29 | timelapse 24h | play hasta el final | recorre con imágenes, sin saltos | recorre hasta 04:15 con imágenes de 512 px (blob); las 8 secciones mantienen el alto (1 sola combinación de altos medida cada 100 ms) | ok |
| 30 | 30d | botón 30d + play desde el inicio + pausa | carga y recorre, sin saltos | solo pide `positions/30d-360m.json` y JPG; barra `[carga] imágenes lasco desde la foto` → `[ok] timelapse: 121/121`; play del 09-10 al 02-11 con el aviso de hueco de c2; consola fija en 173,6 px; en pausa 1024 px | ok |
| 31 | vista «lasco» | 30d, 2026-11-02 06:00, c2, en estático y con backend | imagen alineada con el Sol 3D, igual que con backend | las dos capturas son iguales (c2 @ 04:36, ocultador centrado en el Sol) (`estatico-repo-vista-lasco-20261102T0600.jpg`, `backend-vista-lasco-20261102T0600.jpg`) | ok |
| 32 | consola del navegador | `read_console_messages` desde la recarga | sin errores | sin mensajes | ok |
| 33 | estático en la raíz | `http.server` 5173 sobre el mismo `dist-static` | funciona | igual que en `/repo/`: rutas `/data/…`, 0 `/api` | ok |
| 34 | reintentar | sin `meta.json` → recargar → restaurar → `reintentar` | error con botón y recuperación | `[error] no se pudo leer la foto · sin ella no hay imágenes # no se encontraron los datos de la foto (data/meta.json, data/images.json) reintentar`; al pulsarlo: `[..] leyendo la foto de los datos` → `[ok] datos actualizados…` → `[ok] timelapse: 97/97`; alto constante | ok |
| 35 | build con `--base /repo/` servido en `/repo/` | 4173 | funciona | rutas `/repo/assets/…` y `/repo/data/…`, 0 `/api`, 97/97 | ok |
| 36 | sitio sin `data/` | `data/` renombrada | error claro | `[error] no se pudieron cargar las efemérides: la foto no tiene posiciones para este rango # no se encontraron los datos de la foto (data/positions/1d-15m.json) reintentar`; alto constante | ok |
| 37 | modo con backend: rangos | Vite 5173 + uvicorn 8000 sobre la copia | 4 pestañas, abre en 180d | 24h·30d·90d·180d + «actualizar»; activo 180d; 721/721; 90d 361/361; 30d 121/121; «fuente: backend»; 0 peticiones a `/data/`; consola fija en 173,6 px | ok |
| 38 | modo con backend: «actualizar» | 24h → «actualizar» | `POST /api/sync` + `[sync]` | `POST /api/sync` 202, `GET /api/status` cada ~2 s, línea `[sync] backend lasco descargando de helioviewer (todas las imágenes)` y después `[ok] … cubre … → 2026-11-08 04:30 UTC` y 97/97. Sin errores 4xx/5xx en uvicorn salvo mis 404 a propósito | ok |
| 39 | modo con backend: detalle | pausa en 24h | FITS y eventos | 2 `detalle.fits`, 8 eventos, consola del navegador sin errores | ok |
| 40 | Docker: contexto de build | `docker compose build` con `lasco_backend/export` (32 MB) y `lasco_test/dist-static` (33 MB) presentes | no entran en el contexto | contextos de 32,5 kB y 50,9 kB; `/app` del backend solo tiene `app/` y `requirements.txt`; `/usr/share/nginx/html` solo `assets`, `index.html`, `50x.html` | ok |
| 41 | Docker: panel en 8080 | `docker compose up -d` + Chrome | funciona como antes | contenedores sanos; abre en 180d con las 4 pestañas, `/api/lasco/status`, `/images` y `/files` responden, 706/721 instantes con imagen (el volumen tenía un hueco del 02-11 al 06-11), consola sin errores | ok |

41/41 casos ok.

## Fallos
Ninguno.

## Observaciones (no bloquean)
- **O1** — `export.py`: el resumen dice `[!] 1 avisos:` con un solo aviso. Lo correcto sería «1 aviso».
- **O2** — sin red, el log de la exportación muestra el traceback completo de `httpx.ConnectError`. Sale del log de
  `Syncer`, que ya existía y hace lo mismo en el modo con backend. El resumen final y el código 2 son correctos.
- **O3** — `GET /favicon.ico` da 404 en todos los modos. El proyecto no tiene favicon y en el sitio estático en
  `/repo/` la petición va a la raíz del dominio. Ya pasaba antes del cambio.
- En 30d, «último dato» es el fin del archivo de posiciones (2026-11-08 00:00, por la malla de 6 h). El modo con
  backend hace lo mismo.

## Entorno
- macOS, Python 3.13 (`lasco_backend/.venv`), Node 26.13.0 (nvm), Vite 8.3.5, Chrome (claude-in-chrome), Docker con
  Colima (legacy builder, sin buildx).
- Copia de datos en `mktemp -d` (/var/folders/…/tmp.xauMNJ72vY), con más copias dentro para JPL caído y sin red.
- Puertos: uvicorn en 8001 para comparar posiciones y en 8000 para el modo con backend; `python3 -m http.server` en
  4173 (`/repo/`) y 5173 (raíz) para el sitio estático, con el backend apagado; Vite en 5173 (con backend);
  Docker en 8080.
- Scripts de prueba: `pruebas/verificar_export.py` y `pruebas/api_snapshot.py`. Logs: `export-1.log`,
  `export-2.log`, `estatico-1.log`, `estatico-2.log`, `uvicorn-*.log`, `vite-1.log`, `http-*.log`,
  `docker-build-1.log`.

## Limpieza
- Todo lo de `procesos.md` está cerrado:
  - uvicorn 52441 (8001) y 55762 (8000);
  - `http.server` 53927 (4173) y 53928 (5173);
  - Vite 55896. El 55763 murió al arrancar por usar el Node 18 del PATH;
  - `docker compose down`, sin `-v`. Colima sigue encendido, como estaba;
  - las dos pestañas, con el grupo MCP;
  - borrados el directorio de `mktemp`, `lasco_backend/export/` y `lasco_test/dist-static/`.
- `tester-antes-1` y `tester-despues-1`: **sin diferencias**. Ningún puerto escuchando y ningún contenedor.
- Efectos que quedan, esperables:
  - `lasco_test/dist/` tiene el build normal nuevo (ya existía, lo ignora git);
  - las imágenes `lasco-backend`/`lasco-front` se reconstruyeron;
  - al levantar Docker, el backend sincronizó al arrancar en el volumen `lasco_lasco_data` y borró 4 imágenes de
    más de 180 días. Es el comportamiento normal de `docker compose up`;
  - en `localhost:5173` hice clic en el filtro «normal» para comparar la vista lasco. Después volví a dejar
    `lasco_test.filtro3d = ascii-color`, que era lo que había.
- La base real `lasco_backend/data` está intacta: mismo md5 y misma cantidad de archivos.
