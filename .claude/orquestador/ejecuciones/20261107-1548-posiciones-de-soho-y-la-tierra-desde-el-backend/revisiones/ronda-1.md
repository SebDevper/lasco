# Revisión · ronda 1
veredicto: CAMBIOS

## Comentarios nuevos

### #1 [importante] `lasco_backend/app/positions.py:59-76` y `lasco_backend/app/horizons.py:105-112` — cuando falla el relleno, cada petición vuelve a consultar a JPL (sin espera) y la cola del lock crece sin límite

La caché y el lock protegen a JPL solo mientras JPL responde bien. Si una consulta de vectores falla, no queda nada
anotado. La petición siguiente vuelve a encontrar el mismo faltante y consulta otra vez: 2 intentos, más los 3
reintentos del front ante 502. El desarrollador lo resolvió para el fin de las efemérides (`RETRY_AFTER_FAILURE`),
pero no para el relleno. Tampoco para el fin cuando todavía no hay ningún valor conocido: si el backend arranca con
JPL caído, `_end_known` queda en False y cada petición repite la consulta (2×20 s bajo `_end_lock`).

Lo reproduje con un `httpx.MockTransport` que responde 503 (script en el scratchpad, sin tocar el repo). Faltaba el
instante más reciente de la malla de 15 min y 5 peticiones seguidas a `days=1&stepMinutes=15` hicieron **10
consultas a JPL** (2 por petición). Esto pasa cada vez que aparece un instante nuevo: cada 15 min en la pestaña 24h y
cada 6 h en las demás.

Escenarios concretos:
- **JPL limita la IP del servidor (503 rápidos)**. Basta un `curl` en bucle a `/api/lasco/positions?days=1&stepMinutes=15`
  dentro del límite de `lasco_api` (10/s, ráfaga 40). El servidor sigue consultando a JPL sin parar, una tras otra
  (~1/s), mientras dure el faltante, y así alarga el bloqueo. Antes, nginx limitaba esto a 30/min y 3 conexiones por
  IP. Al quitar esa zona, la única protección es la caché, que se abre del todo cuando JPL falla.
- **JPL colgado (timeouts)**. Cada petición ocupa `_fill_lock` unos 41 s (20 s + 1 s + 20 s). Las que esperan el lock
  no se cancelan cuando nginx corta a los 60 s (el handler de FastAPI sigue vivo). Cada una consulta a JPL cuando le
  toca. Un visitante deja hasta 3 peticiones en cola (reintentos del front) y la cola crece mientras dure la caída.
  Mientras tanto, también esperan las peticiones que ya tienen todo en caché (p. ej. 180d con la malla de 6 h
  completa), porque `_fill` lee la caché dentro del lock.

Qué espero:
- Una espera tras un fallo del relleno, análoga a `RETRY_AFTER_FAILURE`, por ejemplo por objetivo o global. Durante
  ese tiempo `/api/positions` no consulta a JPL: responde 502 de inmediato o, mejor, devuelve lo que haya en caché.
- La misma espera en `soho_ephemeris_end` cuando falla sin valor previo (anotar el instante del fallo y propagar el
  error sin consultar hasta que pase el plazo).
- Conviene un camino rápido: comprobar faltantes **antes** de tomar `_fill_lock` y tomarlo solo si falta algo
  (volviendo a comprobar dentro). Así las peticiones con todo en caché no hacen cola detrás de un relleno lento.
- Documentar la espera en `CLAUDE.md` (viñeta de `horizons.py`/`positions.py`) y en `lasco_backend/README.md`.

### #2 [menor] `lasco_test/src/pages/Dashboard.jsx:315` — la pista del error confunde cuando el backend sí responde

El comentario `# requiere el backend lasco: cd lasco_backend && .venv/bin/uvicorn app.main:app --port 8000` sale con
cualquier error. El caso más probable con el backend levantado es el 502
`no se pudieron cargar las efemérides: no se pudo consultar JPL Horizons`. Ahí la pista lleva a arrancar algo que ya
está corriendo. En producción, además, el visitante ve un comando de desarrollo. Sugerencia: una pista neutra
(`# las posiciones vienen del backend lasco (/api/lasco/positions)`) o mostrar el comando solo cuando el fallo es de
red, 500 de Vite o 502/504 del proxy sin `detail`.

### #3 [menor] `CLAUDE.md:45` y `deploy/README.md:182` — «el navegador no habla con ningún servicio externo» no es cierto

`lasco_test/index.html:7-9` carga JetBrains Mono desde Google Fonts. Mejor «el navegador no llama a ninguna API
externa» o «solo habla con `/api/lasco`», como dice `README.md`: «nunca habla con JPL, Helioviewer ni el HEK».

### #4 [menor] `CLAUDE.md:119` y `lasco_backend/README.md` — falta la espera de 5 min tras un fallo del fin

`CLAUDE.md` dice «si JPL falla, usa el último conocido», pero no que después no vuelve a consultar en 5 min
(`RETRY_AFTER_FAILURE`, como mucho el TTL). Es un cambio fuera del plan, bien razonado y que acepto, pero tiene que
quedar documentado (junto con lo de #1, si se aplica).

### #5 [menor] `.claude/agents/revisor.md:29` — sigue citando `floorToStep`

Ahora es `floor_to_step` en `lasco_backend/app/positions.py`. No estaba en el plan y es configuración del
orquestador, no código del proyecto: lo anoto para que el orquestador decida (no bloquea).

## Revisado sin observaciones
- **Plan**: T1–T8 hechas y dentro del alcance. Sin cambios en `RANGES`, en la malla, en `POST /api/sync`, en la
  escena ni en los compose.
- **Validación de `/api/positions`**: `\d{1,6}` y rango de `days`, `stepMinutes ∈ {15, 360}` y `days·1440/paso + 1 ≤
  800` (24h → 97, 180d → 721, 15 min admite hasta 8 días). El cliente no puede elegir el fin ni fechas. Los
  parámetros extra se ignoran. Los errores van al log y la respuesta solo dice «no se pudo consultar JPL Horizons».
  Ventanas posibles: subconjuntos de una sola malla, así que con JPL sano a JPL solo se le piden instantes nuevos.
- **Concurrencia (simulada)**: 5 peticiones simultáneas 180d/360 con la caché vacía hacen 2 consultas en total (una
  por objetivo), sin paralelo hacia JPL. Repetir no consulta.
- **Reintento por «No ephemeris … after» (simulado)**: con el fin en caché viejo, SOHO falla y se llama a
  `note_ephemeris_limit`. Se recalcula `end = floor(límite − 1 min)` (11:08 → 11:00), se vuelve a pedir y salen 97
  instantes. Es la misma lógica que el antiguo `horizons.js`.
- **Equivalencia con `horizons.js`**: mismos parámetros de Horizons, misma conversión JDTDB → ms al segundo, mismo
  `floor` desde 1970 y mismo fin (`min(ahora, límite − 1 min)` redondeado). `ephemerisEnd` = fin redondeado. Forma de
  los samples igual (`time`, `soho/earth.{time,pos,vel}`). El redondeo a 0,001 km y 1e-6 km/s no se nota en
  `describeSample`. Ahora el reloj es el del servidor y no el del cliente, lo que es mejor.
- **Caché del fin y `RETRY_AFTER_FAILURE`**: TTL con `asyncio.Lock`, caso `None` cacheado y uso del valor anterior
  ante fallos. `default_window` también captura `HorizonsError`. `end` nunca es futuro.
- **`Store`**: tabla nueva con `CREATE TABLE IF NOT EXISTS`, migración de `coverage.step_ms` intacta y PK
  `(target, time_ms)` usada por el `BETWEEN`. El filtro `% step` es correcto porque `start_ms` está en la malla.
  `save_positions` va en una transacción.
- **Retención de posiciones**: corte `ahora − 182 d`, siempre por debajo del inicio más antiguo que acepta la ruta.
  Se ejecuta aunque `RETENTION_DAYS` sea 0.
- **Proxies**: Vite y nginx quedan iguales (solo `/api/lasco`). En nginx se borraron `map`, la `location`, las zonas
  `horizons`/`horizons_conn` y `limit_conn_status`. No se tocaron `lasco_api`/`lasco_files` ni la IP real.
  `proxy_read_timeout 60s` sigue vigente y el comentario de `Dockerfile` está actualizado.
- **Front**: `positions.js` reintenta 502/503/504 y fallos de red, con timeout de 65 s y `detail` en 422/502.
  `Dashboard.jsx` cambia el import y los cuatro textos (tono de terminal, `fmtDateTime`). El efecto conserva
  `cancelled`. `grep api/horizons` en `src` sale vacío.
- **Documentación**: `README.md`, `deploy/README.md`, `lasco_backend/README.md` (variables, límites, tabla de la API,
  «sin backend el panel no carga») y `CLAUDE.md` coinciden con el código, salvo #3 y #4.
- **Verificaciones**: `npm run build` OK (solo el aviso de chunk que ya había) e `import app.main` OK. Aviso:
  importar `app.main` abre `lasco_backend/data/lasco.sqlite3` y crea la tabla `positions` vacía. Es inocuo (lo mismo
  pasará al arrancar) y no cambió ningún otro dato.
