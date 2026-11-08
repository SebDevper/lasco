# Plan · Versión estática del panel para GitHub Pages (v2)

## Cambios tras la revisión del usuario

Aprobado el 2026-11-08 con cambios (ver «Aclaraciones» en `solicitud.md`). Se aplican **solo a la versión
estática**; el modo con backend (dev, Docker, Oracle) sigue con 24h/30d/90d/180d y abre en 180d como hoy.

| tema | v1 | v2 |
|---|---|---|
| rangos de la foto | 24h, 30d, 90d, 180d | **24h y 30d** (máximo 30 días) |
| rango inicial en modo estático | 180d | **24h** |
| ventanas que sincroniza el exportador | 24 h (todas) + 180 d (cada 6 h) | 24 h (todas) + **30 d** (cada 6 h) |
| `EXPORT_RANGES` / archivos de posiciones | 4 | **2**: `1d-15m.json`, `30d-360m.json` |
| eventos exportados | ~182 días | **~32 días** |
| imágenes en la foto | ~1.527 (≈ 148 MB) | **~337 (≈ 31 MB)** |
| encabezados a pedir la primera vez | ~1.520 (3–4 min) | **~330 (< 1 min)** |
| consultas al HEK la primera vez | ~364 | **~66** |
| tráfico por visita (rango inicial) | ≈ 28 MB (180d) | **≈ 2,7 MB** (24h); 30d ≈ 3,9 MB más |

Sin cambios: fecha visible = `generatedAt` (aprobado), se exportan los dos tamaños de imagen (512 y 1024 px),
encabezados rellenados al exportar. Tareas afectadas: T3, T6, T8, T9, T10 (y el plan de pruebas y los riesgos).

## Objetivo

Poder publicar una «foto» del panel sin servidor: un comando del backend junta en una carpeta lo que consume el
front para los rangos **24h y 30d** (posiciones, imágenes C2/C3 en 512 y 1024 px, encabezados FITS, eventos del HEK
y la fecha de la foto), y un build del front en «modo estático» lee esos archivos en vez de la API. En ese modo solo
se ven las pestañas 24h y 30d, abre en 24h, no hay botón «actualizar» ni seguimiento de sincronización, y la consola
dice `[ok] datos actualizados al <fecha UTC>`. El modo con backend queda igual. Crear el repo, subirlo y GitHub
Actions quedan para después.

## Contexto

### Lo que consume el front hoy (todo vía `/api/lasco` → backend)

| función del front | ruta del backend | uso |
|---|---|---|
| `fetchSohoAndEarth` (`lasco_test/src/lib/positions.js:59`) | `GET /api/positions?days=&stepMinutes=` | al cambiar de rango; `RANGES` (`Dashboard.jsx:22`): 1d/15 min, 30d·90d·180d/360 min; inicial `'180d'` (`Dashboard.jsx:110`) |
| `fetchBackendStatus` (`lasco.js:26`) | `GET /api/status` | cobertura (`coverage`) + línea de estado; cada 2 s mientras sincroniza (`Dashboard.jsx:186`) |
| `prefetchFrames` (`lasco.js:164`) | `GET /api/images?instrument=&start=&end=` | lista por coronógrafo; el más cercano a cada instante (`nearest`), JPG de 512 px a blob URL |
| `closestImage` (`lasco.js:75`, desde `useLascoImages`) | `GET /api/images/closest` | imagen de 1024 px al detenerse el instante |
| `requestBackendSync` (`lasco.js:85`) | `POST /api/sync` | botón «actualizar» (`Dashboard.jsx:140,161`) |
| `fetchImageHeader` (`lasco.js:246`) | `GET /api/images/{id}/header` | en pausa (`useLascoDetails`, `lasco.js:281`) |
| `fetchEvents` (`lasco.js:259`) | `GET /api/events?start=&end=` | en pausa, ventana ±6 h redondeada a la hora |
| `<img src>` / `TextureLoader` (`LascoImages.jsx:122`, `SunScene.jsx:301`) | `GET /api/files/{c2|c3}/{id}_{512|1024}.jpg` | mismo origen: sirve como textura WebGL |

Formato de imagen: `_image_json` (`lasco_backend/app/main.py:103`) → `{id, instrument, time, files: {"512": {url,
width, height, scale, rsunPx, centerX, centerY}, "1024": {…}}}`; el front lo adapta en `fromBackend` (`lasco.js:47`).
Posiciones: `positions_window` (`positions.py:75`) → `{end, stepMinutes, days, samples: [{time, soho: [6], earth: [6]}]}`;
el fin lo decide el backend (`floor_to_step(min(ahora, fin efemérides), paso)`). Si JPL falla, devuelve un tramo
incompleto sin avisar más que en el log (el número de `samples` lo delata).

### Piezas del backend que se reutilizan

- `Syncer.run(start, end, step_minutes)` (`sync.py:104`): modo `all` (≤ 48 h, todas las imágenes) o `sampled`
  (tabla `samples`, imagen más cercana por instante). Ya descarga solo lo que falta, marca `coverage` y al final
  hace `prune` (retención 180 + 2 días desde el fin más reciente; posiciones: ahora − 182 días). Lo que hace el
  botón «actualizar» del panel es exactamente `run(primer instante, último instante, paso del rango)`. Que la foto
  sea de 30 días no cambia la retención de la base (el modo con backend sigue necesitando 180 días).
- `positions_window(store, client, days, step)` (`positions.py:75`): llena la caché de posiciones desde JPL.
- `events_between(store, client, a, b)` (`events.py:31`): caché por día UTC; **lanza todos los días en paralelo con
  `asyncio.gather`** y el cliente tiene `max_connections = CONCURRENCY*2 = 12` con timeout 25 s (`sync.py:54`,
  también de pool). Con ~32 días sigue siendo mejor pedirlo por tramos (7 días) para no rozar el `PoolTimeout`.
- Encabezados: `Store.get_header/save_header` (`store.py:283`), `helioviewer.jp2_header` (`helioviewer.py:72`).
  Solo se piden al pausar (`main.py:168`). `sync._retry` (`sync.py:83`) reintenta `httpx.HTTPError` y `ValueError`,
  **no** `ET.ParseError` (es `SyntaxError`).
- `__main__.py`: CLI con subcomando `sync`; se agrega `export` al lado.
- `main.py` crea `Store()`, `Syncer`, monta `StaticFiles` y configura logging al importarse: el exportador **no**
  debe importar `main.py` (por eso `_image_json`/`_iso` se mueven a un módulo propio).

### Medición de los datos locales (`lasco_backend/data`, abierto en solo lectura)

- 319 MB en disco: 3.470 imágenes (c2 1.906, c3 1.564) del 2026-05-06 al 2026-11-04, ambos tamaños. Muchas son de
  mallas antiguas (instantes a las 23:50 o 01:56:59): no hacen falta en la foto.
- Últimos 30 días de la malla de 6 h (121 instantes por coronógrafo): 76 imágenes distintas de c2 (c2 tiene huecos:
  varios instantes comparten imagen) y 121 de c3. Última ventana de 24 h con todas las imágenes: 73 c2 + 75 c3.
  Unión: **337 imágenes** (145 c2, 192 c3).
- Tamaño de la foto: 512 px → 6,4 MB; 1024 px → 24,6 MB; **total ≈ 31 MB** (+ < 1 MB de JSON).
- `headers`: 7 filas → faltan **~330**; a ~0,74 s cada una con 6 en paralelo, < 1 min la primera vez; después solo
  las imágenes nuevas (~150 por día de diferencia, sobre todo de la ventana de 24 h).
- `events`: 58 eventos en 5 días (~18 KB) → ~32 días ≈ 350 eventos, ~0,1 MB de JSON. La primera exportación hace
  **~66 consultas al HEK** (2 por día; 5 días ya están en caché).
- `positions`: la tabla existe pero está vacía (la base es anterior al commit `bb1a664`); la primera exportación
  pide a JPL el fin de las efemérides y los vectores de SOHO y la Tierra para 1d/15 min y 30d/6 h (~5 consultas).
  JSON: 97 y 121 muestras, ~15 KB cada uno.
- Por visita: el rango inicial (24h) precarga ~194 JPG de 512 px ≈ 2,7 MB; la pestaña 30d ≈ 3,9 MB más.

### Restricciones del proyecto que aplican

- Malla fija: la foto usa los mismos fines que `positions_window` (no recalcular la malla en el exportador).
- Textos en español con tono de terminal, fechas con `fmtDateTime`, sin saltos de layout (la consola reserva 4
  líneas: `.console__log` en `index.css:340`).
- Proxies (`vite.config.js`, `nginx.conf.template`) y límites de nginx: **no cambian**.
- `Store`: no hace falta tocar el esquema (solo métodos de lectura nuevos) → sin migración.
- El front de Docker copia todo `lasco_test/` (`COPY . .`): lo generado debe ir en `.dockerignore`.
- Créditos: `README.md:73` ya los tiene completos; el pie del panel (`LascoImages.jsx:346`) no menciona JPL
  Horizons ni la frase de cooperación ESA/NASA.

## Diseño de la foto (carpeta `data/` del sitio)

```
data/
├── meta.json                  # {format: 1, generator: "lasco_backend export", generatedAt, ephemerisEnd,
│                              #  ranges: [{days, stepMinutes, file, start, end, samples}], coverage: {c2: [[a,b]…], c3},
│                              #  counts: {images: {c2, c3}, headers, events}, warnings: [...]}
├── positions/1d-15m.json      # mismo JSON que GET /api/positions (y positions/30d-360m.json)
├── images.json                # {images: {c2: [...], c3: [...]}} con el formato de _image_json, url relativa
│                              #   "images/c2/{id}_{512|1024}.jpg", ordenadas por tiempo
├── headers.json               # {"<id>": {encabezado resumido}, …}  (se carga al primer «pausa»)
├── events.json                # {events: [...], error: null|"…"}   (se carga al primer «pausa»)
└── images/{c2,c3}/{id}_{512|1024}.jpg
```

Fecha mostrada: `generatedAt` = cuándo se hizo la exportación (aprobado por el usuario). La línea de efemérides
sigue mostrando `ephemerisEnd` como «último dato».

## Tareas

- [x] **T1 · Sacar la serialización de imágenes de `main.py`** — mover `_iso` y `_image_json` a un módulo nuevo
  (`app/payloads.py`: `iso(dt)`, `image_json(row, url_prefix="/api/files")`) sin cambiar la salida de la API;
  `main.py` los importa. El exportador usará `url_prefix="images"`.
  - archivos: `lasco_backend/app/payloads.py` (nuevo), `lasco_backend/app/main.py`
  - criterios de aceptación: `GET /api/images`, `/api/images/closest` y `/api/status` devuelven byte a byte lo mismo
    que antes (diff de las respuestas); `payloads.py` no importa `main.py` ni crea `Store`.
  - depende de: —

- [x] **T2 · Lecturas nuevas en `Store`** — métodos de solo lectura, sin tocar el esquema:
  `sample_images(instrument, start, end, step_ms) -> {time_ms: image_id}` (instantes de la malla en la tabla
  `samples`), `images_by_ids(ids) -> list[Row]` (por lotes para no pasar el límite de variables de SQLite) y
  `missing_headers(ids) -> list[str]`.
  - archivos: `lasco_backend/app/store.py`
  - criterios de aceptación: sin cambios en `_SCHEMA` ni en la migración; los métodos usan `self._lock`; con la base
    local, `sample_images('c3', fin-30d, fin, 21_600_000)` devuelve 121 instantes.
  - depende de: —

- [x] **T3 · Comando `python -m app export`** — módulo `app/export.py` y subcomando en `__main__.py`:
  `python -m app export [--out DIR]` (por defecto `lasco_backend/export`). Pasos, en orden:
  1. **Posiciones**: `positions_window` para cada rango de la foto, definidos en la constante
     `EXPORT_RANGES = ((1, 15), (30, 360))` con un comentario «rangos de la versión estática: deben coincidir con los
     que muestra `Dashboard.jsx` en modo estático (`STATIC_RANGE_IDS`)». Si alguno no trae `days*1440/paso + 1`
     instantes (JPL falló), **error fatal**: no se escribe nada.
  2. **Imágenes**: `Syncer(store).run` de la ventana de 24 h (primer → último instante de `1d-15m`, modo `all`) y de
     la de **30 d** (primer → último de `30d-360m`, `step_minutes=360`, 121 instantes): lo mismo que haría
     «actualizar» en esas pestañas. Las ventanas más largas no se sincronizan ni se exportan. Un `state.error` o
     `state.failed` no es fatal: va a `warnings`.
  3. **Selección**: por coronógrafo, la unión de `sample_images` en la malla de 30d (cada instante sin imagen →
     aviso) y `list_images` de la ventana de 24 h. Solo esas imágenes van a la foto (ni las de mallas viejas ni las
     de más de 30 días que la base conserva para el modo con backend).
  4. **Encabezados FITS**: para las imágenes elegidas, reutilizar la tabla `headers` y pedir a Helioviewer **solo las
     que falten** (`missing_headers`), con `CONCURRENCY` en paralelo, reintentos (incluido `ET.ParseError`) y
     `save_header` de cada una. Las que fallen → aviso (el panel muestra «encabezado fits no disponible»).
  5. **Eventos**: `events_between` por tramos de 7 días sobre [inicio 30d − 6 h, fin 24h + 6 h], uniendo por `id`
     y ordenando por `start`. Días que fallen → `error` en `events.json` y aviso.
  6. **Cobertura**: `store.coverage()` recortado a [inicio 30d, max(fin 24h, fin 30d)] (la base puede tener
     ventanas de 180 d: no deben aparecer en la foto).
  7. **Escritura atómica y segura**: todo en una carpeta temporal hermana de `--out`; las imágenes con `os.link`
     (cae a `shutil.copy2` si falla) desde `data/images`; al final se reemplaza `--out`. Si `--out` existe y **no**
     tiene un `meta.json` con `generator == "lasco_backend export"`, se aborta sin borrar nada.
  8. **Resumen** por consola (rango de fechas, imágenes por coronógrafo, encabezados pedidos/reutilizados/fallidos,
     eventos, tamaño, avisos). Código de salida: 0 sin avisos, 2 con avisos (la carpeta se escribió), 1 fatal.
  - archivos: `lasco_backend/app/export.py` (nuevo), `lasco_backend/app/__main__.py`
  - criterios de aceptación: la carpeta tiene exactamente la estructura de «Diseño de la foto» (solo
    `1d-15m.json` y `30d-360m.json` en `positions/`); ambos JSON son iguales a lo que devolvería `GET /api/positions`
    en ese momento; ninguna imagen de `images.json` es anterior a (inicio 30d − 6 h); todos los `files.*.url`
    existen en `images/`; `headers.json` tiene una entrada por imagen (o hay aviso); `meta.coverage` no empieza antes
    del inicio de 30d; una segunda ejecución seguida no pide encabezados ni descarga imágenes (salvo que haya
    avanzado la malla) y deja la misma foto; con `--out` apuntando a una carpeta ajena, sale con error y no la toca;
    no importa `main.py`.
  - depende de: T1, T2

- [x] **T4 · Ignorar lo generado por el backend** — agregar `export/` a `lasco_backend/.gitignore` y
  `lasco_backend/.dockerignore`.
  - archivos: `lasco_backend/.gitignore`, `lasco_backend/.dockerignore`
  - criterios de aceptación: `git status` no muestra `lasco_backend/export/` tras exportar; la imagen del backend no
    lo incluye.
  - depende de: —

- [x] **T5 · Modo estático en la configuración del front** — elegido al compilar:
  - `lasco_test/.env.static` con `VITE_DATA_SOURCE=static`;
  - `package.json`: script `"build:static": "vite build --mode static --outDir dist-static"`;
  - `vite.config.js`: `defineConfig(({ mode }) => …)` con `base: mode === 'static' ? './' : '/'` (relativa: sirve en
    `usuario.github.io/repo/`, en la raíz o en un dominio propio sin conocer el nombre del repo; `--base` la pisa).
    Los proxies no cambian;
  - `src/lib/datasource.js` (nuevo): `STATIC_DATA` (bool), `DATA_URL` (`${import.meta.env.BASE_URL}data/`) y
    `staticJson(nombre)` con promesa cacheada a nivel de módulo y `fetch(…, { cache: 'no-cache' })` (Pages cachea
    10 min: así un despliegue nuevo no mezcla JSON viejos con imágenes nuevas; las JPG tienen nombre inmutable).
  - archivos: `lasco_test/.env.static`, `lasco_test/package.json`, `lasco_test/vite.config.js`,
    `lasco_test/src/lib/datasource.js`
  - criterios de aceptación: `npm run build` produce el mismo `dist/` de siempre (base `/`, `STATIC_DATA` falso);
    `npm run build:static` genera `dist-static/` con rutas relativas en `index.html`.
  - depende de: —

- [x] **T6 · Posiciones en modo estático** — en `fetchSohoAndEarth`, si `STATIC_DATA`, leer
  `positions/${days}d-${stepMinutes}m.json` (mismo parseo); si falta el archivo (404), error en español
  («la foto no tiene posiciones para este rango»). Sin reintentos de backend. Solo existirán `1d-15m` y `30d-360m`.
  - archivos: `lasco_test/src/lib/positions.js`
  - criterios de aceptación: 24h y 30d cargan en el sitio estático sin ninguna petición a `/api/`; el modo con
    backend no cambia.
  - depende de: T5

- [x] **T7 · Imágenes, encabezados y eventos en modo estático** — en `lasco.js`, ramas con `STATIC_DATA`:
  - `fetchBackendStatus()`: carga `meta.json` + `images.json` (una vez), fija `backendCoverage` desde
    `meta.coverage` y devuelve un objeto de estado con `static: true` (`generatedAt`, conteos, `coverage`,
    `warnings`, `sync: { running: false }`) para que `Dashboard` no siga el progreso;
  - `closestImage(inst, date)`: la más cercana del índice cargado (reusar `nearest`) con `fromBackend(img, 1024)`;
  - `prefetchFrames`: usa el índice en memoria en vez de `/images?…` (mismo margen de ±6 h);
  - `fromBackend`: la url en estático es `DATA_URL + f.url`;
  - `fetchImageHeader(id)`: de `headers.json` (cargado una vez); si no está, rechaza como hoy (→ «encabezado fits
    no disponible»);
  - `fetchEvents(start, end)`: de `events.json`, filtrando por solapamiento (`start <= fin && end >= inicio`, como
    `Store.list_events`), ordenados por `start`, mismo mapeo de fechas; `error` = el de `events.json`.
  - `requestBackendSync` no se usa en estático (no hace falta tocarla).
  - archivos: `lasco_test/src/lib/lasco.js`
  - criterios de aceptación: en el sitio estático el timelapse de 24h y 30d se reproduce con imágenes, al pausar se
    ve la de 1024 px, el detalle FITS, los eventos y los sectores de CME; la vista «lasco» alinea la imagen como en
    el modo con backend; en DevTools no hay peticiones a `/api/`.
  - depende de: T5

- [x] **T8 · Interfaz del modo estático** — en `Dashboard.jsx`, con `STATIC_DATA`:
  - **rangos**: `STATIC_RANGE_IDS = ['24h', '30d']` (comentario: «deben coincidir con `EXPORT_RANGES` en
    `lasco_backend/app/export.py`»); la botonera de rango muestra solo esos y el estado inicial es `'24h'`
    (`useState(STATIC_DATA ? '24h' : '180d')`). El modo con backend sigue con los 4 rangos y abre en `'180d'`;
  - no se dibuja el botón «actualizar» (la fila de rango queda igual de alta);
  - `BackendLine` estático: `[ok] datos actualizados al <fmtDateTime(generatedAt)> · versión estática ·
    <n> imágenes` (`[!]` en ámbar y «· <n> avisos» si `meta.warnings` no está vacío);
  - línea de efemérides: «efemérides jpl horizons (foto estática) · último dato …»;
  - error de carga: comentario «# no se encontraron los datos de la foto (data/…)» en vez del de uvicorn;
  - líneas `[info]`: sin «ejecuta «actualizar»…» ni la de retención; en su lugar «la foto no tiene imágenes para
    todo el rango»;
  - el polling de `/status` no corre (no hay `sync.running`).
  En `LascoImages.jsx`: con `STATIC_DATA` y `events.json` con `error`, el aviso dice «[!] la foto no tiene todos los
  eventos» en vez de «hek no respondió: mostrando caché». En ambos modos, el pie de créditos agrega «posiciones: jpl
  horizons (nasa/jpl)» (enlace) y «soho es un proyecto de cooperación internacional entre la esa y la nasa».
  - archivos: `lasco_test/src/pages/Dashboard.jsx`, `lasco_test/src/components/LascoImages.jsx`
  - criterios de aceptación: en estático solo aparecen las pestañas 24h y 30d y la página abre en 24h; los textos
    nuevos mantienen el tono de terminal; la consola no cambia de alto al cargar ni al reproducir (4 líneas
    reservadas); el modo con backend se ve exactamente como antes (4 pestañas, abre en 180d) salvo la línea de
    créditos.
  - depende de: T6, T7

- [x] **T9 · Script de construcción del sitio** — `deploy/estatico.sh [--base RUTA]` (bash, `set -euo pipefail`,
  mismo estilo que `subir.sh`), desde cualquier carpeta del repo:
  1. `lasco_backend/.venv/bin/python -m app export --out lasco_backend/export` (código 2 → muestra los avisos y
     sigue; 1 → aborta);
  2. `npm run build:static` en `lasco_test` (pasando `-- --base RUTA` si se indicó; si no encuentra `npm`, sugiere el
     PATH de nvm de `CLAUDE.md`);
  3. copia `lasco_backend/export` a `lasco_test/dist-static/data` y crea `dist-static/.nojekyll`;
  4. imprime tamaño (`du -sh`, esperado ~30–40 MB), avisa si pasa de 1 GB o algún archivo de 100 MB, y cómo
     probarlo en local.
  En el comentario de cabecera: la foto cubre 24h y 30d. Agregar `dist-static` a `lasco_test/.gitignore` y
  `lasco_test/.dockerignore`. No se crea el workflow.
  - archivos: `deploy/estatico.sh` (nuevo, ejecutable), `lasco_test/.gitignore`, `lasco_test/.dockerignore`
  - criterios de aceptación: con backend apagado, el script deja un `lasco_test/dist-static/` autocontenido que
    funciona servido desde una subcarpeta; `docker compose build front` no envía `dist-static` en el contexto.
  - depende de: T3, T4, T5

- [x] **T10 · Documentación** — reflejar que el panel ahora tiene dos modos:
  - `CLAUDE.md`: sección «Versión estática (GitHub Pages)» (comando `export`, `build:static`, `VITE_DATA_SOURCE`,
    estructura de `data/`, `deploy/estatico.sh`; la foto solo tiene 24h y 30d y abre en 24h; el exportador
    reutiliza `Syncer`/`positions_window`/`events_between` y la tabla `headers`); matizar «Sin backend el panel no
    carga» (punto 1 del flujo de datos); avisar que `EXPORT_RANGES` (backend) y `STATIC_RANGE_IDS` (front) van
    juntos;
  - `README.md`: en «Cómo funciona» y «Publicarlo», la alternativa estática (foto con fecha de 24h y 30d, sin
    «actualizar», ~30–40 MB) con los comandos;
  - `lasco_backend/README.md`: uso de `python -m app export`, qué hace (sincroniza 24 h y 30 d, rellena
    encabezados, exporta), códigos de salida y que no conviene correrlo a la vez que un servidor sincronizando
    sobre la misma base;
  - `deploy/README.md`: una línea al principio que apunte a la alternativa estática.
  - archivos: `CLAUDE.md`, `README.md`, `lasco_backend/README.md`, `deploy/README.md`
  - criterios de aceptación: ninguna frase de la documentación contradice el comportamiento nuevo; los comandos
    documentados funcionan tal cual.
  - depende de: T3, T8, T9

## Plan de pruebas

**No tocar los datos del usuario**: el exportador sincroniza y aplica la retención sobre la base. Para probar,
clonar `lasco_backend/data` al scratchpad (`cp -cR`, APFS) y usar `LASCO_DATA_DIR=<copia>`; `--out` también en el
scratchpad. Anotar todo en `pruebas/procesos.md`.

1. **Builds**: `npm run build` (debe salir igual que antes: `dist/index.html` con rutas `/assets/…`) y
   `npm run build:static` (rutas `./assets/…`, `dist-static/`).
2. **Regresión de la API (T1)**: con el backend en el puerto 8000 sobre la copia, guardar antes y después del cambio
   las respuestas de `GET /api/images?start=2026-11-03T00:00:00Z&end=2026-11-04T00:00:00Z`,
   `GET /api/images/closest?instrument=c3&date=2026-11-03T12:00:00Z` y `GET /api/status` (ignorando `sync`) y
   comparar con `diff`. `GET /api/images/{id}/header` sigue funcionando y 404 con un id que no está.
3. **Exportación (T3)** — `LASCO_DATA_DIR=<copia> .venv/bin/python -m app export --out <scratch>/export`:
   - código de salida 0 o 2, y el resumen por consola;
   - `meta.json`: `generatedAt` ≈ ahora, `format: 1`, **2 rangos** (1d/15, 30d/360);
   - `positions/`: solo `1d-15m.json` (97 muestras, minutos 00/15/30/45) y `30d-360m.json` (121 muestras,
     00/06/12/18 UTC); comparar cada uno con `GET /api/positions?days=1&stepMinutes=15` y `?days=30&stepMinutes=360`
     del backend sobre la misma copia (iguales);
   - `images.json`: cada `url` existe en disco; ninguna imagen anterior a (inicio 30d − 6 h); cada instante de la
     malla de 30d tiene imagen c2 y c3 a < 3 h (o figura en `warnings`; c2 tiene huecos reales); la ventana de 24h
     trae todas las imágenes (~70+ por coronógrafo); en total del orden de 340 imágenes;
   - `meta.coverage` empieza en el inicio de 30d (no arrastra las ventanas de 180 d de la base);
   - `headers.json`: una entrada por imagen; en la base de la copia, `headers` pasa de 7 a ~340 filas;
   - `events.json`: cubre ~32 días (del día anterior al inicio de 30d hasta el fin), sin `id` repetidos;
   - tamaño de `export/` ≈ 30–40 MB (`du -sh`);
   - la base de la copia conserva sus imágenes de 180 d (la exportación no borra nada que no borrara una
     sincronización normal);
   - **segunda ejecución** inmediata: 0 encabezados pedidos, 0 imágenes descargadas en el resumen, misma foto;
   - **seguridad**: `--out` apuntando a una carpeta con un archivo cualquiera → código 1 y la carpeta intacta;
   - **JPL caído** (opcional, p. ej. `HORIZONS_API` inválida o sin red): código 1 y no se escribe/reemplaza `--out`.
4. **Sitio estático en una subcarpeta (T5–T9)**: `deploy/estatico.sh` (con la copia: `LASCO_DATA_DIR`), o los pasos
   a mano; servir con `mkdir <scratch>/www && ln -s …/dist-static <scratch>/www/repo && python3 -m http.server 4173
   -d <scratch>/www` y abrir `http://localhost:4173/repo/` **con el backend apagado** (8000 libre). Comprobar en el
   navegador:
   - en la pestaña Network no hay ninguna petición a `/api/`; los JSON y JPG salen de `/repo/data/…`;
   - la página abre en **24h** y la botonera de rango solo tiene **24h y 30d**;
   - consola: `[ok] datos actualizados al … UTC · versión estática`, sin botón «actualizar», y la línea de
     efemérides con el último dato; la consola no cambia de alto;
   - 24h y 30d: la barra de cobertura del timelapse se llena y «play» recorre con imágenes;
   - en pausa: imagen de 1024 px, detalle FITS (6 líneas), eventos ±6 h, sectores de CME y botón «ver»;
   - vista «lasco»: la imagen queda alineada con el Sol 3D (comparar con el modo con backend en el mismo instante);
   - créditos visibles con JPL Horizons;
   - también servida en la raíz (`-d dist-static`, `http://localhost:4173/`) funciona.
5. **Modo con backend sin cambios**: `npm run dev` + backend sobre la copia: aparecen las 4 pestañas y abre en 180d;
   «actualizar» en 24h sigue haciendo `POST /api/sync` y el seguimiento `[sync]`; cargan posiciones, imágenes,
   encabezados y eventos como antes.
6. **Docker** (opcional, si Colima está arriba): `docker compose build front` — el contexto no incluye
   `dist-static`; el front sigue sirviendo en 8080. nginx no cambia.
7. `git status`: no aparecen `lasco_backend/export/` ni `lasco_test/dist-static/`.

## Riesgos y decisiones

- **Encabezados FITS: se rellenan al exportar, no al sincronizar (recomendado, sin objeciones del usuario).**
  Evaluado pedirlos en la sincronización al descargar cada imagen:
  - a favor: la exportación no pediría nada y el modo con backend tendría el detalle al instante;
  - en contra: +1 petición a Helioviewer por imagen nueva (+50 % sobre las 2 descargas) y ~0,74 s más en cada
    sincronización, incluido el `POST /api/sync` público del modo con backend; guarda encabezados que en el modo
    con backend casi nadie abre (y con la foto de 30 días, también los de 90/180 d que la foto no usa); obliga a
    decidir si un fallo del encabezado cuenta como imagen fallida (afecta `coverage` y el 10 %); y no evita el
    relleno, porque las imágenes ya guardadas no tienen encabezado. Al exportar cuesta < 1 min la primera vez y
    luego solo las imágenes nuevas. Si más adelante se quiere, puede ser un opcional (`LASCO_SYNC_HEADERS=1`) que
    llame a la misma función.
- **Rangos duplicados entre front y backend**: `EXPORT_RANGES` (backend) y `STATIC_RANGE_IDS` (front) deben
  coincidir; si no, una pestaña daría «la foto no tiene posiciones para este rango». Se comenta en ambos y en
  `CLAUDE.md`; generar uno desde el otro (p. ej. leyendo `meta.ranges` antes de pintar la botonera) complicaría la
  carga inicial más que el problema.
- **La base sigue teniendo 180 días**: la foto de 30 días no cambia la retención (`LASCO_RETENTION_DAYS`) ni las
  ventanas del modo con backend. El exportador selecciona y recorta la cobertura; no borra nada.
- **El exportador modifica la base local** (descarga lo que falte y aplica la retención normal): es intencional
  (reutiliza lo descargado). No correrlo mientras un servidor local sincroniza sobre la misma base (dos procesos,
  dos `Syncer` sin lock común); se documenta.
- **Consultas externas en la primera exportación**: ~330 encabezados (Helioviewer), ~66 consultas al HEK y ~5 a JPL,
  con la concurrencia existente (`CONCURRENCY` = 6), por tramos en el HEK y con reintentos.
- **Fallos parciales** (algunas imágenes, encabezados o días del HEK) no bloquean: la foto se escribe y los avisos
  quedan en `meta.json` y en la consola (código 2). Posiciones incompletas sí bloquean: el panel mostraría una
  línea de tiempo recortada sin avisar.
- **`base: './'`** (relativa) en vez de pedir el nombre del repo: funciona en cualquier subcarpeta porque el panel es
  una sola página sin router. Hay que verificar que `import.meta.env.BASE_URL` resuelve bien los `fetch` de `data/`
  en `/repo/` (prueba 4); si no, usar `new URL('data/', document.baseURI)`.
- **Caché de Pages (10 min)**: JSON con `cache: 'no-cache'` (revalida con ETag, 304 barato); JPG con nombre único.
- **Tráfico**: con el rango inicial en 24h, cada visita precarga ≈ 2,7 MB (y ≈ 3,9 MB más si abre 30d); con
  ~100 GB/mes de Pages ya no es una preocupación (el riesgo de 28 MB por visita de la v1 desaparece).
- **Tamaño**: ≈ 31 MB de imágenes en los dos tamaños; muy lejos del 1 GB de Pages. Sin cambios en los tamaños, a
  pedido del usuario.
- **Un `images.json` y no consultas por rango**: ~0,15 MB se cargan una vez; replica en memoria lo que hacían
  `/images` y `/images/closest`. `headers.json` y `events.json` se cargan solo al primer «pausa».
- **Copiar las JPG con `os.link`** evita duplicar en disco; si el sistema no lo permite, se copia.
- **Refactor de `_image_json`** (T1): riesgo bajo, cubierto por el diff de respuestas.

## Fuera de alcance

- Crear el repositorio en GitHub, subir el sitio, configurar GitHub Pages y el workflow de GitHub Actions
  (`workflow_dispatch`) — el script `deploy/estatico.sh` deja listo `lasco_test/dist-static/` para subirlo después.
- Rangos de 90d y 180d en la versión estática.
- Cambios en el modo con backend: rangos, rango inicial (180d), retención, API pública y sus validaciones (salvo el
  traslado sin cambios de T1).
- Commitear imágenes o datos al repositorio.
- Cambios en proxies (`vite.config.js` `server/preview.proxy`, `nginx.conf.template`), límites de nginx, Caddy,
  `docker-compose*.yml` y el despliegue en Oracle.
- Pedir encabezados en la sincronización (`LASCO_SYNC_HEADERS`) o cambiar los tamaños de imagen.
- Modo estático en `npm run dev` (se prueba con el build).
