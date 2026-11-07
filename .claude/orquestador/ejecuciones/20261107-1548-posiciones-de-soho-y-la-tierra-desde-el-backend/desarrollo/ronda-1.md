# Desarrollo · ronda 1
origen: plan

## Cambios
- `lasco_backend/app/config.py` (T1): `POSITIONS_STEP_MINUTES = (15, 360)`, `POSITIONS_MAX_DAYS` (180),
  `POSITIONS_MAX_SAMPLES` (800), `EPHEMERIS_CHECK_MINUTES` (60), cada uno con su variable `LASCO_*`, más `SOHO_ID` y
  `EARTH_ID`, con un comentario como el de los otros límites públicos.
- `lasco_backend/app/store.py` (T2): tabla `positions` en `_SCHEMA` (`CREATE TABLE IF NOT EXISTS`, PK
  `(target, time_ms)`). Métodos nuevos `get_positions` (solo devuelve instantes de la malla:
  `(time_ms − start) % step = 0`), `save_positions` (`executemany` con `INSERT OR REPLACE`, una transacción) y
  `prune_positions`. La migración de `coverage.step_ms` queda igual.
- `lasco_backend/app/horizons.py` (T3), reescrito:
  - `_query`: timeout de 20 s y 2 intentos. Solo reintenta fallos de red y 5xx; un 4xx falla de inmediato.
  - `soho_ephemeris_end` guarda el resultado en memoria durante `EPHEMERIS_CHECK_MINUTES`, con `asyncio.Lock`
    (incluye el caso `None` = hay datos hasta ahora). Si JPL falla y ya había un valor, usa ese; si nunca hubo, propaga
    el error.
  - `note_ephemeris_limit(limit)` corrige el fin guardado.
  - `fetch_vectors` usa los mismos parámetros que usaba el front, parsea `$$SOE…$$EOE` y convierte JDTDB → ms al
    segundo, tomando TDB como UTC.
  - Errores propios: `HorizonsError` y `EphemerisLimitError(HorizonsError)`, que lleva el límite.
- `lasco_backend/app/sync.py` (T3/T5):
  - `default_window` usa el fin guardado en caché y ahora captura también `HorizonsError`.
  - `Syncer._prune()` siempre borra primero las posiciones anteriores a ahora − (`POSITIONS_MAX_DAYS` + 2) días,
    aunque `RETENTION_DAYS` sea 0, y lo registra en el log. Después sigue con la retención de imágenes de antes.
- `lasco_backend/app/positions.py` (T4, nuevo):
  - `floor_to_step` cuenta desde 1970-01-01 UTC.
  - `positions_window` calcula fin e inicio y rellena la caché bajo un `asyncio.Lock` de módulo: SOHO primero y
    después la Tierra, una consulta por objetivo, con el rango `[primer faltante, último faltante]`. Si recibe
    `EphemerisLimitError`, corrige el fin y reintenta una vez. La respuesta va en orden temporal, solo con instantes
    que tienen los dos objetivos, redondeados a 0,001 km y 1e-6 km/s.
  - Cada consulta a JPL deja una línea INFO `JPL Horizons <obj>: <ini> → <fin> cada N min, F filas (faltaban M)`.
- `lasco_backend/app/main.py` (T5): ruta `GET /api/positions`.
  - Valida a mano para que el `detail` del 422 sea un texto en español: `days` y `stepMinutes` como `\d{1,6}`,
    rango de días, paso permitido y máximo de instantes.
  - Responde 502 `"no se pudo consultar JPL Horizons"` ante `httpx.HTTPError`, `HorizonsError` o `ValueError`. El
    detalle solo va al log.
  - Agrega la línea en el docstring de rutas.
- `lasco_test/src/lib/positions.js` (T6, nuevo; se borró `horizons.js`): `fetchSohoAndEarth({ days, stepMinutes })`
  pide `/api/lasco/positions` y devuelve la misma forma que antes (`time: Date`, `soho/earth: { time, pos, vel }`,
  `ephemerisEnd: Date`). Reintenta hasta 3 veces ante 502/503/504 o fallo de red, con espera creciente y timeout de
  65 s (así llega primero el 504 de nginx a los 60 s). Ante 422 o 502 muestra el `detail` del backend.
- `lasco_test/src/pages/Dashboard.jsx` (T6): cambian el import y los cuatro textos del plan. El resto del flujo queda
  igual.
- `lasco_test/vite.config.js`, `lasco_test/nginx.conf.template`, `lasco_test/Dockerfile` (T7):
  - Se borraron el proxy `/api/horizons`, el `map $arg_COMMAND`, `location = /api/horizons`, las zonas `horizons` y
    `horizons_conn`, `limit_conn_status` y su explicación.
  - El comentario de `lasco_api` y el de `location /api/lasco/` ahora mencionan las posiciones.
  - No se tocaron `lasco_api`, `lasco_files` ni la parte de IP real.
- Documentación (T8):
  - `CLAUDE.md`: «Proyecto», «Contenedores», «Flujo de datos» 1, «Rangos» (con un párrafo nuevo de los límites de
    `/api/positions`) y la lista del backend (`horizons.py`/`positions.py`, tabla `positions`, retención propia, subir
    también `LASCO_POSITIONS_MAX_DAYS`).
  - `README.md`: diagrama, fila del backend y la frase del navegador (tampoco habla con JPL; sin backend el panel no
    carga).
  - `deploy/README.md`: diagrama y viñetas del backend y de nginx.
  - `lasco_backend/README.md`: intro con una viñeta de posiciones, las 3 variables nuevas, `/api/positions` en
    «Límites» y en la tabla de la API, y la línea final.

## Verificación
- `npm run build` (Node 26): OK. El aviso de chunk > 500 kB ya estaba. `grep -rn "api/horizons" lasco_test/src`
  no devuelve nada.
- `.venv/bin/python -c "import app.main"`: OK.
- T1: los valores por defecto son los del plan y `LASCO_POSITIONS_MAX_DAYS=90` los cambia.
- T2: abrí con `Store` una copia de `data/lasco.sqlite3` en el scratchpad.
  - Aparece la tabla `positions` y se conservan 3470 imágenes, 38 coverage, 4326 samples y 58 eventos.
  - `/api/status` en otra copia muestra las mismas imágenes y la misma cobertura.
  - Guardar y leer devuelve los mismos valores, y el filtro de malla funciona.
  - `prune_positions` borra solo lo anterior al corte.
- T3, contra JPL real:
  - dos `soho_ephemeris_end` seguidas hacen una sola consulta;
  - `fetch_vectors` cae exacto en la malla (`…T18:00:00`);
  - start = stop pide también el instante anterior, porque JPL responde «start must be earlier than stop»;
  - un rango que pasa del fin da `EphemerisLimitError` con el límite (hoy JPL tiene SOHO hasta 2026-12-14 23:51);
  - un objetivo inválido da `HorizonsError`.
- T4 y T5, con uvicorn en el puerto 8001, `LASCO_DATA_DIR` temporal y `LASCO_SYNC_ON_START=0`:
  - las 10 peticiones inválidas responden 422 con `detail` en español (`days=0/181/1.5/abc/-1`, sin `days`, sin
    `stepMinutes`, `stepMinutes=60/0` y `days=30&stepMinutes=15` → «La ventana tiene 2881 instantes…»);
  - 5 `curl` en paralelo a 180/360 con la base vacía: todas 200 y una sola consulta a JPL por objetivo;
  - 1/15 da 97 instantes, el último igual a `end`, todos en :00/:15/:30/:45. Pidió solo los 93 que faltaban: los
    4 instantes de 6 h ya estaban en caché;
  - 30/90/180 con paso 360 dan 121/361/721 instantes, todos a 00/06/12/18, sin consultas nuevas; 180d pesa ~141 KB;
  - repetir una petición no consulta a JPL (0,002 s frente a 1,4 s);
  - el parámetro extra `&end=2030-01-01` deja la respuesta idéntica;
  - `/docs` y `/openapi.json` siguen en 404;
  - un `POST /api/sync {"hours":24,"until":"ephemeris"}` después de pedir posiciones no vuelve a consultar el fin:
    hay una sola línea «fin de las efemérides» en el log;
  - exactitud: el instante 2026-11-06 18:30 coincide con una consulta directa a JPL con los parámetros del front,
    con diferencia por debajo del redondeo, para SOHO y para la Tierra.
- Errores (TestClient con `horizons.HORIZONS_API` apuntando a un puerto cerrado):
  - sin caché: 502 `{"detail":"no se pudo consultar JPL Horizons"}`;
  - con el fin anterior y la caché llena: 200 (se usa el fin anterior y queda registrado);
  - si falta un día de datos: 502.
- Retención: inserté filas de hace 200 días y corrí `python -m app sync --hours 1` (temporal). El log dice
  «Retención de posiciones … 2 borradas» y las 97 recientes de cada objetivo siguen ahí.
- Regresión rápida: `/api/events` fuera de ventana responde 422 y `POST /api/sync` en el futuro también.
- Vite dev en 5173 con el backend en 8000 (temporal):
  - `/api/lasco/positions` responde por el proxy;
  - `/api/horizons` ya no llega a JPL: devuelve el `index.html` del SPA;
  - el 422 llega con su `detail`.
- No probé en el navegador ni con Docker: Colima no estaba arrancado y esas pruebas están en el plan del tester.
- Detuve todo lo que arranqué. Los puertos 8000, 8001 y 5173 quedaron libres (estaban libres antes). Los datos de
  prueba están en el scratchpad de la sesión; no toqué `lasco_backend/data/`.

## Notas para el revisor / tester
- Agregué algo que no está en el plan, en `horizons.py`. Si JPL falla y ya hay un fin guardado, no se vuelve a
  consultar hasta dentro de 5 min (`RETRY_AFTER_FAILURE`, como mucho el TTL). Sin esto, con JPL caído cada petición
  de posiciones esperaría 2×20 s antes de usar el valor anterior.
- Hoy las efemérides de SOHO llegan a 2026-12-14, semanas por delante. Por eso `end` = ahora redondeado al paso
  (`2026-11-07T16:00Z` en 24h; `12:00Z` en 6 h) y por ahora no se puede reproducir el reintento por «No ephemeris …
  after» con datos reales. Sí probé que `fetch_vectors` lanza `EphemerisLimitError` pasando del fin. La corrección y
  el reintento en `positions_window` siguen el diseño, pero no se ejecutaron de punta a punta. Se puede forzar con
  un script que fije `horizons._end_value` a una fecha futura, `_end_known = True` y `_end_next_check` lejano.
- Con el fin en «ahora», el instante más reciente de la pestaña 24h es una predicción de JPL (igual que antes en el
  front).
- `stepMinutes` se valida con el tipo `int`. `stepMinutes=15.0` responde 422, igual que `days=1.5`; el front siempre
  manda enteros.
- La ruta abre un `httpx.AsyncClient` por petición (`new_client()`), igual que `/api/events`.
- El `asyncio.Lock` del fin y el del relleno son de módulo. Con Python 3.13 se asocian al loop recién al haber
  contención, así que sirven en uvicorn y en la CLI.
- Para el tester: falta el paso de Docker (nginx valida la configuración, `/api/horizons` sirve el SPA, ráfaga
  contra `lasco_api`) y comprobar en el navegador los 4 rangos y los textos nuevos.
