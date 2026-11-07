# Plan · Posiciones de SOHO y la Tierra desde el backend

## Objetivo
El navegador deja de hablar con JPL Horizons: el front pide las posiciones de SOHO y la Tierra al backend
(`GET /api/lasco/positions`), que las consulta a Horizons una sola vez por instante de la malla fija y las guarda en
SQLite. Se borra el proxy de Horizons de `vite.config.js` y de `nginx.conf.template` (con su `map` y sus límites), así
el servidor publicado deja de ser un proxy hacia JPL. Lo que ve el usuario no cambia (mismos rangos, mismo «último
dato», mismas métricas), salvo que ahora el panel necesita el backend para mostrar algo.

## Contexto

### Front
- `lasco_test/src/lib/horizons.js` (133 líneas): `fetchSohoAndEarth({ days, stepMinutes, until })` (:109) calcula
  `stop = floorToStep(now, step)` (:99, :110), `start = stop − days`, pide SOHO (`'-21'`) y, si Horizons responde
  «No ephemeris … after», reintenta con `stop = floorToStep(límite − 1 min)` (:116-121); luego pide la Tierra
  (`'399'`) con la misma ventana (:122). Parámetros: `CENTER '500@10'`, `REF_PLANE 'ECLIPTIC'`, `OUT_UNITS 'KM-S'`,
  `VEC_TABLE '2'`, `CSV_FORMAT 'YES'`, `STEP_SIZE '<n> m'` (:55-69). Convierte JDTDB → `Date` redondeando al segundo
  (:93) y trata la escala TDB como UTC (las horas de la malla salen exactas: Horizons interpreta `START_TIME` en TDB y
  devuelve JDTDB). Devuelve `{ samples: [{ time, soho: {time,pos,vel}, earth: {time,pos,vel} }], ephemerisEnd: stop }`.
  Reintento ×3 con 502/503/504 y timeout 45 s (:40-53).
- `describeSample({ time, soho, earth })` (`src/lib/orbit.js:33`) solo usa `time`, `soho.pos`, `soho.vel`,
  `earth.pos`, `earth.vel`.
- `lasco_test/src/pages/Dashboard.jsx`: importa `fetchSohoAndEarth` (:7), lo llama en el efecto de `[rangeId,
  reloadKey]` (:198-216) con `range.days`/`range.stepMinutes` de `RANGES` (:22-27: 24h = 1 día/15 min, 30/90/180d =
  paso 360); textos: `consultando jpl horizons` (:307), error `no se pudieron cargar las efemérides: …` con
  `# requiere npm run dev o npm run preview (proxy de vite)` (:311-312), `[ok] efemérides jpl horizons · último dato
  …` (:319), `'Horizons no devolvió datos para ese rango'` (:205). `loadImages()` usa `described[0].time` y
  `described.at(-1).time` para `POST /api/sync` (:169-173): las horas tienen que seguir cayendo en la malla.
- `lasco_test/src/lib/lasco.js`: patrón del cliente del backend (`BACKEND = '/api/lasco'`, `backendJson`,
  `withTimeout`, :7-68).
- `lasco_test/vite.config.js:9-19`: proxy `/api/horizons` → `https://ssd.jpl.nasa.gov/api/horizons.api` y
  `/api/lasco` → `127.0.0.1:8000/api`; comentario de cabecera (:4-8) habla de Horizons.
- `lasco_test/nginx.conf.template`: comentario de zonas (:14-20), `limit_req_zone … zone=horizons` (:23),
  `limit_conn_zone … horizons_conn` (:24), `limit_conn_status 429` (:26, solo lo usa Horizons), `map $arg_COMMAND
  $horizons_target_ok` (:29-34) y `location = /api/horizons` (:45-61). `/api/lasco/` tiene `limit_req zone=lasco_api
  burst=40 nodelay` y `proxy_read_timeout 60s` (:69-75). `gzip_types` incluye `application/json`.
- `lasco_test/Dockerfile:3`: comentario `/api/horizons → JPL Horizons`.

### Backend
- `lasco_backend/app/horizons.py` (36 líneas): `soho_ephemeris_end(client)` pide SOHO en `[ahora−1 h, ahora]` y, si
  hay «No ephemeris … after», devuelve ese límite − 1 min (o `None` si hay datos hasta ahora). Sin caché: cada llamada
  es una consulta a JPL.
- `lasco_backend/app/sync.py:62-73` `default_window()` la usa con `until="ephemeris"` (arranque, CLI y
  `POST /api/sync` con `{hours, until}`: hoy cada una de esas peticiones públicas consulta a JPL). `_retry()`
  (:81-88, ×3) y `new_client()` (:53-59, timeout `REQUEST_TIMEOUT` = 25 s). `Syncer._prune()` (:164-176) llama a
  `store.prune(cutoff)` al final de cada `run()`; `_retention_cutoff()` devuelve `None` con `RETENTION_DAYS <= 0`.
- `lasco_backend/app/main.py`: docstring con la lista de rutas (:1-14); `_parse`, `_iso` (:82-91); `/api/events`
  como modelo de validación de una ruta pública GET que consulta un servicio externo (:178-188); `_snap_to_grid` y
  `_check_window` (:200-245) como modelo de malla fija desde 1970-01-01 UTC. Sin `/docs` ni `/openapi.json` (:77).
- `lasco_backend/app/config.py`: límites públicos con variable de entorno y comentario (:36-52); `HORIZONS_API` (:59).
- `lasco_backend/app/store.py`: `_SCHEMA` con `CREATE TABLE IF NOT EXISTS` (:12-62) — una tabla nueva se crea sola en
  bases existentes; la migración de `Store.__init__` (:83-89) solo hace falta para columnas nuevas y hay que
  conservarla. `prune()` (:201-240) devuelve `{"images", "samples", "windows", "events"}`. Todo acceso con
  `self._lock`.
- `lasco_backend/Dockerfile`: el healthcheck da margen porque al arrancar se consulta Horizons (sigue siendo cierto).

### Documentación que contradice el cambio
- `CLAUDE.md`: «Contenedores» (párrafo de `nginx.conf.template`: `/api/horizons` → JPL, `COMMAND '-21'/'399'`, límite
  «Horizons 30/min y 3 conexiones», «si el front pide algo nuevo a Horizons…»); «Flujo de datos» punto 1; «Rangos»
  (`floorToStep` en `horizons.js`); lista del backend (no menciona posiciones).
- `README.md:18-21` (diagrama con `/api/horizons`), `:30` (el navegador «nunca habla con Helioviewer ni con el HEK»).
- `deploy/README.md:7-8` (diagrama: front → JPL Horizons) y `:180-181` (nginx «y el proxy a JPL Horizons…»).
- `lasco_backend/README.md`: intro (:3-19), «Uso» (:31), «Variables de entorno» (:49-64), «Límites» (:66-82), tabla
  de la API (:84-94) y `:100` («Si el backend está apagado, el panel funciona sin imágenes LASCO»: deja de ser cierto).

### Restricciones del proyecto que aplican
- Malla fija: los instantes son múltiplos del paso desde 1970-01-01 UTC (6 h → 00/06/12/18 UTC); `POST /api/sync`
  solo acepta esa malla en ventanas largas. El fin es el de las efemérides de SOHO (o ahora) redondeado hacia abajo.
- La API es pública: cada ruta que consulta un servicio externo tiene que estar acotada (ventana, parámetros) y los
  errores no deben filtrar detalles internos (se registran en el log; la respuesta solo dice qué servicio falló).
- JPL limita por IP y responde 503 a ráfagas en paralelo: desde el servidor, consultas de una en una.
- Al cambiar un proxy, cambiar ambos (Vite y nginx). Textos de la UI con el tono de terminal.

## Diseño acordado (lo usan todas las tareas)

**Ruta**: `GET /api/positions?days=<int>&stepMinutes=<int>` (por el front: `/api/lasco/positions`).

- El cliente **no elige el fin**: el backend lo calcula. `fin = floor_to_step(min(ahora, fin_efemérides_SOHO), paso)`
  (si Horizons dice que hay datos hasta ahora, `fin = floor_to_step(ahora, paso)`); `inicio = fin − days`. Así las
  ventanas posibles son subconjuntos de una sola malla que termina donde decide el servidor: la caché se aprovecha y
  no se puede usar para pedir a JPL fechas o pasos arbitrarios.
- Validación (422 con `detail` en español): `days` entero en `[1, POSITIONS_MAX_DAYS]` (180); `stepMinutes` en
  `POSITIONS_STEP_MINUTES = (15, 360)`; instantes `days·1440/paso + 1 ≤ POSITIONS_MAX_SAMPLES` (800). Con eso: 24h/15
  → 97 instantes, 180d/360 → 721; 30d con paso 15 (2.881) → 422. Parámetros extra se ignoran.
- Respuesta:
  ```json
  { "end": "2026-11-06T18:00:00Z", "stepMinutes": 360, "days": 180,
    "samples": [ { "time": "2026-05-10T18:00:00Z", "soho": [x, y, z, vx, vy, vz], "earth": [x, y, z, vx, vy, vz] } ] }
  ```
  km y km/s, heliocéntricas, eclíptica J2000, en orden temporal; solo los instantes con las dos posiciones. Posición
  redondeada a 0,001 km y velocidad a 1e-6 km/s (la respuesta de 180d queda en ~150 KB).
- **Caché** en SQLite: tabla `positions (target TEXT NOT NULL, time_ms INTEGER NOT NULL, x, y, z, vx, vy, vz REAL NOT
  NULL, PRIMARY KEY (target, time_ms))`. Para cada objetivo (`-21`, `399`) se buscan los instantes de la malla que
  faltan y se piden a Horizons en **una** consulta `[primer faltante, último faltante]` con ese paso (lo que ya estaba
  se reemplaza con `INSERT OR REPLACE`). La malla de 15 min contiene a la de 6 h, así que se reutilizan entre sí.
- **Consultas a JPL**: un `asyncio.Lock` de módulo serializa el relleno de la caché (varias peticiones simultáneas con
  caché vacía hacen una sola consulta por objetivo; la segunda encuentra la caché llena). SOHO y la Tierra, una tras
  otra, nunca en paralelo. Cada consulta con timeout de 20 s y como mucho 2 intentos (que el caso normal quede por
  debajo de los 60 s de `proxy_read_timeout` de nginx; si no, el front reintenta y encuentra la caché rellenada).
  Cada consulta a JPL deja una línea `INFO` en el log (objetivo, rango, paso, filas) para poder contarlas.
- **Fin de las efemérides con caché**: en `horizons.py`, `soho_ephemeris_end` pasa a cachear su resultado en memoria
  durante `EPHEMERIS_CHECK_MINUTES` (60, variable `LASCO_EPHEMERIS_CHECK_MINUTES`), con lock. Si JPL falla y hay un
  valor anterior, se usa ese (y se registra); si no hay ninguno, se propaga el error (`default_window` ya cae a
  «ahora»; `/api/positions` responde 502). `default_window` (arranque, CLI, `POST /api/sync` con `until`) usa la misma
  caché: los `POST /api/sync` públicos dejan de consultar a JPL cada vez.
- Si al pedir vectores Horizons responde «No ephemeris … after» (la caché del fin quedó vieja), se actualiza el fin
  con ese límite − 1 min, se recalcula la ventana y se reintenta una vez (el mismo comportamiento que tenía el front).
- Conversión de tiempos igual que el front: `time_ms = round((JDTDB − 2440587.5)·86400)·1000`, tomando TDB como UTC.
- **Retención**: las posiciones se borran con su propio corte, independiente de `LASCO_RETENTION_DAYS`:
  `ahora − (POSITIONS_MAX_DAYS + RETENTION_MARGIN_DAYS)` días, en el mismo momento que la limpieza de imágenes (fin de
  `Syncer.run`). Nada anterior a ese corte se puede pedir por la ruta.
- **Errores**: 422 validación; 502 `"no se pudo consultar JPL Horizons"` (detalle solo en el log).

## Tareas
- [x] **T1 · Configuración de la ruta de posiciones** — agregar a `config.py`, con comentario en el estilo de los
  límites públicos existentes: `POSITIONS_STEP_MINUTES = (15, 360)`, `POSITIONS_MAX_DAYS`
  (`LASCO_POSITIONS_MAX_DAYS`, 180), `POSITIONS_MAX_SAMPLES` (`LASCO_POSITIONS_MAX_SAMPLES`, 800),
  `EPHEMERIS_CHECK_MINUTES` (`LASCO_EPHEMERIS_CHECK_MINUTES`, 60) y los objetivos `SOHO_ID = "-21"`,
  `EARTH_ID = "399"`.
  - archivos: `lasco_backend/app/config.py`
  - criterios de aceptación: `python -c "import app.config"` sin errores; los valores por defecto son los indicados y
    se pueden cambiar por entorno.
  - depende de: —

- [x] **T2 · Tabla `positions` en `Store`** — agregar la tabla a `_SCHEMA` (con `CREATE TABLE IF NOT EXISTS`) y
  métodos con `self._lock`: `get_positions(target, start, end, step_ms) -> dict[int, tuple]` (solo instantes de la
  malla), `save_positions(target, rows)` (`INSERT OR REPLACE`, una transacción) y `prune_positions(cutoff) -> int`.
  Mantener intacta la migración de `coverage.step_ms` en `__init__`.
  - archivos: `lasco_backend/app/store.py`
  - criterios de aceptación: una base creada con el código anterior (`data/lasco.sqlite3` copiada a un directorio
    temporal con `LASCO_DATA_DIR`) abre sin errores, gana la tabla y conserva imágenes/coverage/samples/eventos;
    guardar y leer filas devuelve los mismos valores; `prune_positions` borra solo lo anterior al corte.
  - depende de: —

- [x] **T3 · Cliente de Horizons en el backend** — en `horizons.py`: (a) `soho_ephemeris_end` con caché en memoria
  (TTL `EPHEMERIS_CHECK_MINUTES`, `asyncio.Lock`, uso del último valor si JPL falla, error si nunca hubo valor) y una
  forma de actualizar ese valor cuando una consulta de vectores devuelve «No ephemeris … after»; (b)
  `fetch_vectors(client, target, start, stop, step_minutes)` con los mismos parámetros que el front
  (`CENTER '500@10'`, `REF_PLANE 'ECLIPTIC'`, `OUT_UNITS 'KM-S'`, `VEC_TABLE '2'`, `CSV_FORMAT 'YES'`,
  `OBJ_DATA 'NO'`, `STEP_SIZE '<n> m'`), parseo de `$$SOE…$$EOE` y conversión JDTDB → ms como el front; si no hay
  `$$SOE`, lanza un error propio con el límite (si lo hay) o un error genérico (sin volcar la respuesta al cliente).
  Timeout 20 s y 2 intentos por consulta. `default_window` en `sync.py` sigue funcionando igual pero usa la versión con
  caché.
  - archivos: `lasco_backend/app/horizons.py`, `lasco_backend/app/sync.py`
  - criterios de aceptación: dos llamadas seguidas a `soho_ephemeris_end` hacen una sola consulta a JPL; los tiempos
    de `fetch_vectors` caen exactos en la malla (p. ej. `…T18:00:00Z`, no `17:59:59.999`); un rango que pasa del fin
    de las efemérides de SOHO produce el error con el límite; `python -m app sync --hours 1` sigue funcionando.
  - depende de: T1

- [x] **T4 · Servicio de posiciones** — módulo nuevo `lasco_backend/app/positions.py` con
  `async def positions_window(store, client, days, step_minutes) -> dict`: calcula fin/inicio (función
  `floor_to_step` desde 1970-01-01 UTC), lee la caché, bajo el lock de módulo pide a JPL lo que falte (SOHO y luego la
  Tierra, de a una consulta por objetivo), reintenta una vez si el fin quedó viejo, guarda y arma la respuesta del
  diseño (orden temporal, solo instantes con ambos objetivos, redondeo). Registrar en el log cada consulta a JPL.
  - archivos: `lasco_backend/app/positions.py`
  - criterios de aceptación: con la caché vacía, `days=1, step=15` hace exactamente 1 consulta por objetivo y devuelve
    97 instantes cada 15 min terminando en `end`; repetirla no consulta a JPL; tras `days=180, step=360`, `days=30` y
    `days=90` con paso 360 no consultan a JPL; las peticiones simultáneas con caché vacía hacen una sola consulta por
    objetivo.
  - depende de: T2, T3

- [x] **T5 · Ruta `GET /api/positions` y retención** — en `main.py`: la ruta con la validación del diseño (422 con
  mensajes en español; `days` y `stepMinutes` enteros), 502 `"no se pudo consultar JPL Horizons"` ante
  `httpx.HTTPError` o respuesta inesperada (detalle solo en el log), y la línea en el docstring de rutas. En
  `sync.py` `Syncer._prune()`: llamar también a `store.prune_positions(ahora − (POSITIONS_MAX_DAYS +
  RETENTION_MARGIN_DAYS) días)` aunque `RETENTION_DAYS` sea 0 (es otra caché, acotada por la ruta), registrando
  cuántas se borraron.
  - archivos: `lasco_backend/app/main.py`, `lasco_backend/app/sync.py`
  - criterios de aceptación: los casos de «Plan de pruebas · Backend» dan los códigos indicados; `end` nunca es
    futuro y siempre es múltiplo del paso; las posiciones anteriores al corte desaparecen tras una sincronización;
    `/docs` y `/openapi.json` siguen dando 404.
  - depende de: T4

- [x] **T6 · Front: posiciones desde el backend** — reemplazar `src/lib/horizons.js` por `src/lib/positions.js`
  (borrar el archivo viejo) con `fetchSohoAndEarth({ days, stepMinutes })` que llama a
  `/api/lasco/positions?days=…&stepMinutes=…` y devuelve **la misma forma** que antes (`samples` con `time: Date`,
  `soho/earth: { pos, vel }`; `ephemerisEnd: Date` = `end`). Reintento ante 502/503/504 o fallo de red (hasta 3, espera
  creciente) y timeout ≥ 60 s; con 422 mostrar el `detail`. En `Dashboard.jsx`: actualizar el import y los textos sin
  romper el tono: cargando `consultando posiciones · backend lasco (jpl horizons)`, ok `efemérides jpl horizons (vía
  backend) · último dato …`, error con el comentario `# requiere el backend lasco: cd lasco_backend &&
  .venv/bin/uvicorn app.main:app --port 8000` (en vez de «proxy de vite»), y `'el backend no devolvió posiciones
  para ese rango'`. El resto del flujo (`describeSample`, `loadImages`, `POST /api/sync`) sin cambios.
  - archivos: `lasco_test/src/lib/positions.js` (nuevo), `lasco_test/src/lib/horizons.js` (borrar),
    `lasco_test/src/pages/Dashboard.jsx`
  - criterios de aceptación: `npm run build` sin errores; `grep -rn "api/horizons" lasco_test/src` vacío; los cuatro
    rangos cargan con el mismo número de instantes que antes (97 / 121 / 361 / 721) y el mismo «último dato»; en la
    pestaña de red solo hay peticiones a `/api/lasco/…`.
  - depende de: T5

- [x] **T7 · Quitar el proxy de Horizons (Vite y nginx)** — `vite.config.js`: borrar la entrada `/api/horizons` y
  actualizar el comentario (solo queda el backend). `nginx.conf.template`: borrar el `map $arg_COMMAND`, la
  `location = /api/horizons`, las zonas `horizons` y `horizons_conn`, `limit_conn_status` (ya no hay `limit_conn`) y
  la explicación de esas zonas; mencionar en el comentario de `lasco_api` que incluye las posiciones. No tocar
  `lasco_api`/`lasco_files` ni la parte de IP real. `lasco_test/Dockerfile`: comentario de cabecera.
  - archivos: `lasco_test/vite.config.js`, `lasco_test/nginx.conf.template`, `lasco_test/Dockerfile`
  - criterios de aceptación: `grep -n -i horizons` en los tres archivos vacío (salvo, si acaso, una mención de que
    las posiciones vienen del backend); el contenedor `front` arranca (nginx valida la configuración);
    `curl 'http://localhost:8080/api/horizons?COMMAND=%27-21%27'` ya no devuelve JSON de JPL; `/api/lasco/positions`
    responde por nginx.
  - depende de: T6

- [x] **T8 · Documentación** — actualizar:
  - `CLAUDE.md`: párrafo de «Contenedores» (nginx solo hace `/api/lasco/`; quitar `COMMAND`, Horizons 30/min y
    3 conexiones; la nota pasa a «si el front hace más peticiones al backend, revisar `lasco_api`»); «Flujo de datos»
    punto 1 (el backend pide a Horizons y cachea en `positions`; `GET /api/positions`, el fin lo decide el backend,
    reintento con «No ephemeris … after» en el backend; caché del fin 60 min); «Rangos» (`floor_to_step` ahora en
    `positions.py`; límites de `/api/positions`); lista del backend (`horizons.py`/`positions.py`, tabla
    `positions` en `store.py`, su retención propia).
  - `README.md`: diagrama (front solo → `/api/lasco`; backend → JPL Horizons, Helioviewer, HEK) y la frase del
    navegador (tampoco habla con JPL).
  - `deploy/README.md`: diagrama (JPL Horizons cuelga del backend) y la viñeta de nginx (solo límites por IP).
  - `lasco_backend/README.md`: intro (también sirve las posiciones), variables nuevas en la tabla, `/api/positions`
    en la tabla de la API y en «Límites», y reemplazar la línea 100: sin backend el panel no carga (ni posiciones ni
    imágenes).
  - archivos: `CLAUDE.md`, `README.md`, `deploy/README.md`, `lasco_backend/README.md`
  - criterios de aceptación: `grep -rn -i "api/horizons\|horizons 30\|COMMAND" CLAUDE.md README.md deploy/README.md
    lasco_backend/README.md` vacío; lo que dicen coincide con el código (rutas, límites, valores por defecto).
  - depende de: T5, T7

## Plan de pruebas

### Build
- `cd lasco_test && npm run build` (Node 26: `export PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"`).
- `cd lasco_backend && .venv/bin/python -c "import app.main"`.

### Backend (local, `LASCO_DATA_DIR` en un directorio temporal dentro del scratchpad o de `$HOME`, puerto 8001 para
no chocar con otro; `LASCO_SYNC_ON_START=0` para las pruebas de caché y `1` para comprobar el arranque)
- `GET /api/positions?days=1&stepMinutes=15` → 200, 97 `samples`, todos los `time` múltiplos de 15 min, el último
  igual a `end`, `end ≤ ahora` y `end` = fin de efemérides de SOHO redondeado a 15 min (comparar con
  `curl 'https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%27-21%27&EPHEM_TYPE=VECTORS&CENTER=%27500@10%27&START_TIME=%27<hoy−1h>%27&STOP_TIME=%27<ahora>%27&STEP_SIZE=%271h%27'`).
- `days=180&stepMinutes=360` → 721 instantes, todos a 00/06/12/18 UTC; luego `days=30` (121) y `days=90` (361) con
  paso 360 sin nuevas líneas de consulta a JPL en el log.
- Repetir cualquiera → sin consulta a JPL y claramente más rápida.
- `sqlite3 <dir>/lasco.sqlite3 "SELECT target, COUNT(*) FROM positions GROUP BY target"`: ambos objetivos con el
  mismo número de filas.
- Exactitud: para un instante, comparar `soho` y `earth` con una consulta directa a JPL con los mismos parámetros que
  usaba el front (diferencia ≤ 0,001 km y ≤ 1e-6 km/s).
- 422: `days=0`, `days=181`, `days=1.5`, `days=abc`, sin `days`, sin `stepMinutes`, `stepMinutes=60`,
  `stepMinutes=0`, `days=30&stepMinutes=15` (2.881 instantes). Un parámetro extra (`&end=2030-01-01`) no cambia la
  respuesta.
- Concurrencia: base vacía y 5 `curl` en paralelo a `days=180&stepMinutes=360` → todas 200 con los mismos datos y una
  sola consulta a JPL por objetivo en el log.
- Fin de efemérides: dos peticiones seguidas → una sola consulta del fin a JPL; `POST /api/sync` con
  `{"hours": 24, "until": "ephemeris"}` tras haber pedido posiciones no consulta el fin otra vez (dentro de los 60 min).
- Error de JPL (si es viable, con un script Python que use `httpx.MockTransport` o parcheando `HORIZONS_API` a una
  dirección inválida en el proceso de prueba): sin caché → 502 con `"no se pudo consultar JPL Horizons"` y sin
  detalles internos; con caché del fin anterior → se usa ese fin.
- Migración: copiar una base del código anterior (`lasco_backend/data/lasco.sqlite3` o una creada con el commit base)
  a un directorio temporal, arrancar → tabla `positions` creada y `/api/status` con las mismas imágenes y coverage.
- Retención: insertar filas en `positions` con `time_ms` de hace 200 días, ejecutar una sincronización
  (`python -m app sync --hours 1`) → esas filas desaparecen y las recientes quedan.
- Regresión: `/api/status`, `/api/images…`, `/api/events` (422 fuera de ventana), `POST /api/sync` (422/429) siguen
  igual; `/docs` y `/openapi.json` → 404.

### Front (dev: backend en 8000 + `npm run dev`, navegador)
- Los cuatro rangos cargan; consola con los textos nuevos (`consultando posiciones…`, `[ok] efemérides jpl horizons
  (vía backend) · último dato …`); mismo número de instantes (97/121/361/721).
- Pestaña de red: ninguna petición a `/api/horizons`; una sola a `/api/lasco/positions` por cambio de rango.
- Vista 3D, gráficas (`HaloChart`, `DistanceChart`), telemetría y tabla iguales que antes para el mismo instante
  (comparar algunos valores —distancia al Sol, a la Tierra, velocidad— con el commit base si hace falta).
- «actualizar» sigue lanzando `POST /api/sync` con la ventana correcta (malla de 6 h en 30/90/180d) y el timelapse
  carga las imágenes.
- Backend apagado → `[error] no se pudieron cargar las efemérides: …` con el comentario del backend y el botón
  «reintentar» funcionando al volver a levantarlo.
- `npm run preview` también funciona (mismo proxy).

### Docker (toca nginx)
- `colima start` si hace falta; `docker compose up -d --build` → http://localhost:8080 carga el panel completo.
- `docker compose logs front`: nginx sin errores de configuración.
- `curl -s 'http://localhost:8080/api/lasco/positions?days=1&stepMinutes=15' | head -c 300` → JSON.
- `curl -si 'http://localhost:8080/api/horizons?COMMAND=%27-21%27'` → ya no es JPL (sirve `index.html` del SPA).
- Ráfaga de ~60 peticiones rápidas a `/api/lasco/status` → aparecen 429 (`lasco_api` sigue vigente).
- Opcional: prueba de producción local con `SITE_ADDRESS=:80 HTTP_PORT=8081` (sin bind mounts desde /tmp).
- Anotar contenedores y volúmenes en `pruebas/procesos.md`; `docker compose down` al terminar (sin `-v` sobre
  `lasco_data` si ya existía de antes).

## Riesgos y decisiones
- **El panel ahora depende del backend**: antes, sin backend, había posiciones y vista 3D sin imágenes; ahora no carga
  nada. Es consecuencia directa de lo pedido (el front solo usa `/api/lasco`); se documenta y el mensaje de error
  apunta al backend.
- **El cliente no elige el fin ni fechas**: descartado `GET /api/positions?start=&end=` porque permitiría pedir a JPL
  ventanas arbitrarias (amplificación) y llenaría la caché con instantes fuera de la malla. Descartado también
  `?range=24h|30d…` porque duplicaría `RANGES` en el backend; `days` + `stepMinutes` acotados cubre lo mismo.
- **Fin de efemérides cacheado 60 min**: cuando JPL publica una predicción nueva, el panel puede tardar hasta una hora
  en mostrar el nuevo «último dato» (antes era inmediato). Se acepta: reduce consultas a JPL y es configurable.
- **Predicciones revisadas**: las posiciones de SOHO cerca del fin son predicciones y JPL puede refinarlas; quedan
  cacheadas con el primer valor. La diferencia es de kilómetros sobre ~1,5 millones (invisible en el panel). No se
  agrega refresco de los últimos días (posible mejora futura).
- **Tiempos de respuesta**: con caché vacía, la primera petición de 180d hace hasta 3 consultas a JPL en serie; si JPL
  va lento puede acercarse a los 60 s de nginx. Mitigación: timeout 20 s × 2 intentos, lock (la petición siguiente
  espera y encuentra la caché llena) y reintento del front ante 504. El arranque del backend ya calienta la caché del
  fin.
- **Lock global**: un relleno lento bloquea otras peticiones de posiciones mientras dura; aceptable (sucede una vez
  por instante nuevo) y es lo que evita ráfagas en paralelo hacia JPL.
- **Retención propia de posiciones**: no se ata a `LASCO_RETENTION_DAYS` para no borrar y volver a pedir posiciones
  si alguien baja la retención de imágenes; queda acotada por `POSITIONS_MAX_DAYS`. Si se agrega un rango más largo
  en `RANGES`, subir `LASCO_POSITIONS_MAX_DAYS` además de la retención (anotarlo en `CLAUDE.md`).
- **Límites de nginx**: al quitar la zona `horizons` las posiciones quedan bajo `lasco_api` (10/s, ráfaga 40). Es una
  petición por cambio de rango, muy por debajo; la protección de JPL pasa a ser la caché + lock del backend.
- **Tamaño de la respuesta**: ~150 KB para 180d, similar a lo que se bajaba de JPL (dos respuestas de texto). Sin
  compresión en el backend (fuera de alcance).
- **HMR**: borrar `horizons.js` y crear `positions.js` no afecta los `Map` de `lasco.js`.

## Fuera de alcance
- Compresión gzip en el backend o `gzip_proxied` en nginx.
- Refrescar posiciones ya cacheadas (predicciones revisadas por JPL).
- Cambios en `RANGES`, en la malla, en `POST /api/sync`, en imágenes/eventos/encabezados o en la escena 3D.
- Cambios en Caddy, `docker-compose*.yml` (no hacen falta variables nuevas: los valores por defecto sirven) y en los
  scripts de `deploy/`.
- Tests automáticos o linter (el proyecto no los tiene).
