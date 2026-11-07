# Pruebas · ronda 1
veredicto: APROBADO

## Casos
| # | caso | cómo | esperado | obtenido | resultado |
|---|---|---|---|---|---|
| 1 | Build del front | `npm run build` (Node 26) | sin errores | OK en 375 ms; solo el aviso de chunk > 500 kB que ya existía | ok |
| 2 | Import del backend | `python -c "import app.main"` con `LASCO_DATA_DIR` temporal | sin errores | OK | ok |
| 3 | Greps de T6/T7/T8 | `grep api/horizons` en `src`; `grep -i horizons` en vite/nginx/Dockerfile; `grep api/horizons\|horizons 30\|COMMAND` en la documentación | vacío, salvo una mención de que las posiciones vienen del backend | `src`: vacío. Docs: vacío. Config: solo `vite.config.js:5` («las pide a JPL Horizons»), que es la mención permitida | ok |
| 4 | Concurrencia con caché vacía | 5 `curl` en paralelo a `days=180&stepMinutes=360` (8001) | todas 200, iguales, una consulta por objetivo | 5×200 en ~4 s, mismo md5. Log: 1 consulta del fin, 1 de `-21` y 1 de `399` | ok |
| 5 | 180d | `check.py` | 721 instantes a 00/06/12/18, último = `end`, `end` ≤ ahora | 721, horas {00,06,12,18}, contiguos, `end` 2026-11-07T12:00Z; 133 KB | ok |
| 6 | 30d y 90d después de 180d | `curl` + log | 121 y 361 instantes, sin consultas a JPL | 121 y 361, 0 consultas nuevas (17 y 28 ms) | ok |
| 7 | 24h | `days=1&stepMinutes=15` | 97 cada 15 min, último = `end` | 97, `end` 16:15Z. Solo pidió los 93 que faltaban: 4 ya venían de la malla de 6 h | ok |
| 8 | Repetición | la misma petición 2 veces | sin consulta y más rápida | 1,22 s → 0,015 s; respuesta idéntica; 180d repetida en 0,045 s | ok |
| 9 | `end` y fin de efemérides | JPL directo: SOHO hasta 2026-DEC-14 23:51 TDB | `end` = ahora redondeado al paso | 16:15Z a las 16:20 (15 min) y 12:00Z (6 h) | ok |
| 10 | SQLite | `SELECT target, COUNT(*) FROM positions GROUP BY target` | mismo número por objetivo | `-21` 814 / `399` 814; tras más pruebas, 906 / 906 | ok |
| 11 | Exactitud | 2026-11-07 12:00 y 12:15, consulta directa a JPL con los parámetros del front viejo | ≤ 0,001 km, ≤ 1e-6 km/s | SOHO: 0,00047 km y 4,9e-7. Tierra: 0,00048 km y 3,9e-7 | ok |
| 12 | 422 | `days=0/181/1.5/abc/-1/%201/9999999999`, sin `days`, sin `stepMinutes`, `stepMinutes=60/0/15.0/-15`, `days=30&stepMinutes=15` | 422 con `detail` en español | los 14 → 422 con mensajes claros, p. ej. «La ventana tiene 2881 instantes; el máximo es 800» | ok |
| 13 | Parámetro extra / método | `&end=2030-01-01`; `POST /api/positions` | respuesta idéntica; 405 | idéntica (cmp); 405 | ok |
| 14 | Caché del fin con `POST /api/sync` | `{"hours":1,"until":"ephemeris"}` después de pedir posiciones | no consulta el fin otra vez | seguía habiendo 1 línea «fin de las efemérides» en el log; 202 y luego 409 | ok |
| 15 | Retención de posiciones | 3 filas de hace 200 días + sincronización | se borran solo esas | «Retención de posiciones … 3 borradas»; quedan 906/906 | ok |
| 16 | JPL caído, caché vacía | `fallo_jpl.py` con `httpx.MockTransport` que rechaza la conexión | 502 sin detalles internos; la repetición no consulta | 502 `{"detail":"no se pudo consultar JPL Horizons"}` en 1,0 s; repetida en 0,004 s sin consultas nuevas | ok |
| 17 | JPL con 503 HTML, caché vacía | mock 503 | 502 | 502 con el mismo `detail`, 2 intentos | ok |
| 18 | Fin en caché viejo («No ephemeris … after») | mock con límite = ahora − 3 h y fin en caché «hasta ahora» | corrige el fin y reintenta una vez | 200, 97 instantes, `end` 13:15Z = floor(límite − 1 min). 3 consultas: SOHO falla, SOHO, Tierra. La repetición no consulta | ok |
| 19 | TTL del fin vencido y JPL caído, con fin anterior | mock caído | 200 con el fin anterior; después, espera de 5 min | 200, 97 instantes (2 consultas del fin); la repetición, 0 consultas | ok |
| 20 | JPL caído y falta el inicio de la ventana | `days=2` | 502 | 502 | ok |
| 21 | JPL caído y falta el último instante | fin un paso más adelante | respuesta degradada | 200 con 96 instantes y `end` = el último guardado | ok |
| 22 | Migración | copia de `data/lasco.sqlite3` (lectura `mode=ro`) sin la tabla `positions`; se abre con `Store()` | se crea la tabla y se conservan los datos | `positions` creada; images 3470, coverage 38, samples 4326, headers 7, events 58, igual que antes; `coverage.step_ms` presente | ok |
| 23 | Regresión API | `/docs`, `/openapi.json`, `/redoc`; `/api/events` de 2020; `/api/images`; `POST /api/sync` (futuro, paso 7, 100 h sin paso, cooldown) | 404; 422; 200; 422 / 429 con `Retry-After` | todos como se esperaba | ok |
| 24 | Proxy de Vite (dev) | `curl` por 5173 | posiciones 200; `/api/horizons` ya no va a JPL; 422 con `detail` | 200; `/api/horizons` devuelve el `index.html` del SPA; 422 con `detail` | ok |
| 25 | Navegador: carga y cambio de rango (dev) | Chrome headless por CDP (`navegador.py rangos`): 180d (el rango por defecto) → 30d → 90d → 180d → 24h | textos nuevos, sin errores, solo `/api/lasco/…` | `[ok] efemérides jpl horizons (vía backend) · último dato 2026-11-07 12:00 UTC` (16:15 en 24h). 0 peticiones a `/api/horizons` ni a jpl.nasa.gov. Una petición de posiciones por cambio de rango; al montar salen 2 por `StrictMode` en dev. Consola: solo el 404 de `favicon.ico`, que ya existía | ok |
| 26 | Vista 3D, telemetría e imágenes | capturas `nav/01-24h.png` (es 180d) y `nav/07-actualizar.png` | se ven como antes | Sol, órbita, SOHO/L1 y Tierra. Telemetría: 147,009 M km, 1.295.317 km, 29,54 km/s. Imágenes C2/C3 cargadas. Los valores salen de las mismas posiciones (caso 11) | ok |
| 27 | «actualizar» en 24h | clic + red | `POST /api/sync` en la malla; el timelapse carga | cuerpo `{"start":"2026-11-06T16:15:00Z","end":"2026-11-07T16:15:00Z","stepMinutes":15}` → 202; termina con `timelapse: 97/97` | ok |
| 28 | Ventana de sync de 30d | `POST /api/sync` con la ventana que manda el panel en 30d (10-08 12:00 → 11-07 12:00, paso 360) | 202 (malla de 6 h aceptada) | 202 `mode: sampled` | ok |
| 29 | Backend apagado y «reintentar» | `navegador.py sin-backend`: 8000 apagado → error → se levanta el backend → clic en «reintentar» | error con el comando del backend; reintentar carga | 3 intentos (502 de Vite) → `[error] no se pudieron cargar las efemérides: backend respondió 502 # requiere el backend lasco: cd lasco_backend && .venv/bin/uvicorn app.main:app --port 8000 [reintentar]`; después del clic, `[ok] … último dato 2026-11-07 12:00 UTC` | ok |
| 30 | `npm run preview` | 4173 | posiciones por el proxy | index 200; posiciones 97/15 min; `/api/horizons` devuelve el SPA | ok |
| 31 | Docker: build y nginx | `docker compose up -d --build`; `nginx -t`; logs del front | arranca sin errores de configuración | backend healthy; `nginx -t` OK; logs sin `emerg`/`error`. La configuración generada solo tiene las zonas `lasco_api` y `lasco_files` (sin `horizons`, `limit_conn` ni `COMMAND`) | ok |
| 32 | Docker: posiciones por nginx | `curl :8080/api/lasco/positions` (1/15 y 180/360); 422 | JSON | 97 instantes en la malla; 180d con `Content-Encoding: gzip`; el 422 llega con su `detail` | ok |
| 33 | Docker: `/api/horizons` | `curl -si ':8080/api/horizons?COMMAND=%27-21%27&format=json'` | ya no es JPL | 200 `text/html` con el `index.html` del SPA (659 B) | ok |
| 34 | Docker: `lasco_api` | 60 peticiones (30 en paralelo) a `/api/lasco/status` y luego a `/positions` | aparecen 429 | status: 45×200 + 15×429; positions: 4×200 + 56×429 | ok |
| 35 | Docker: migración del volumen existente | arranque con `lasco_lasco_data`, que venía del código anterior | abre y usa la tabla nueva | arrancó healthy; conserva c2 797 / c3 838 imágenes; rellenó `positions` (1/15: 97; 180d: 717 + 4) | ok |
| 36 | Docker: panel en el navegador | `navegador.py` con `URL=http://localhost:8080/`, los 4 rangos | carga, consola limpia, solo `/api/lasco` | los 4 rangos `[ok]`, timelapse 106/121 (30d) y 97/97 (24h); todas las respuestas 200; consola sin errores. Hubo 24 `ERR_ABORTED` de prefetch `_512.jpg` por cambiar de rango rápido: es la cancelación normal, no tiene que ver con este cambio | ok |

36/36 casos ok.

Sin probar: la prueba opcional de producción local (`SITE_ADDRESS=:80 HTTP_PORT=8081`), porque el puerto 8081 no está entre los que vigila el orquestador.

## Fallos
Ninguno.

Observaciones (no son fallos):
- En dev, `StrictMode` hace 2 peticiones de posiciones al montar (y 2×3 intentos con el backend apagado). Pasaba igual con Horizons antes. En el build de 8080 hay una sola.
- El log del backend con un 503 de JPL incluye la URL completa de Horizons. Solo va al log; el cliente recibe el `detail` genérico.

## Entorno
- macOS, Python 3.13 (`lasco_backend/.venv`), Node 26.13.0, Vite 8.3.5, Google Chrome headless manejado por CDP con `--remote-debugging-pipe`, sin puerto (la extensión claude-in-chrome no estaba conectada). nginx 1.29.8 en Docker sobre Colima.
- Backend en 8001 y en 8000 con `LASCO_DATA_DIR` en `mktemp -d` y `LASCO_SYNC_ON_START=0`. Vite dev en 5173 y preview en 4173. Docker en 8080 (proyecto `lasco`).
- Scripts y salidas en `pruebas/`: `check.py`, `exact.py`, `fallo_jpl.py` (+ `fallo_jpl-1.log`), `navegador.py`, `analiza.py`, `nav/` y `nav8080/` (capturas y eventos CDP), `r1/` (JSON), logs `uvicorn-*.log`, `vite-1.log`, `preview-1.log`, `docker-*-1.log`, `compose-up-1.log`, `colima-1.log`.
- `lasco_backend/data/` solo se leyó (copia con `mode=ro`).

## Limpieza
Todo lo que figura en `procesos.md` quedó cerrado:
- uvicorn 11251, 12667 y 14774; Vite 12929; preview 14984.
- Los procesos de Chrome 13482, 13850, 14622 y 18724.
- Los directorios temporales `tmp.OmKimpdR5u`, `tmp.pUq6oLkBp4` y `tmp.40NHvLbBkO`, y el perfil de Chrome que dejó el primer intento fallido.
- `docker compose down` sin `-v`: el volumen `lasco_lasco_data` existía de antes y sigue ahí, ahora con la tabla `positions`.
- `colima stop`, porque estaba apagado al empezar.

`tester-antes-1` y `tester-despues-1`: sin diferencias. No queda nada escuchando en los puertos vigilados y Docker no está disponible, igual que al empezar.
