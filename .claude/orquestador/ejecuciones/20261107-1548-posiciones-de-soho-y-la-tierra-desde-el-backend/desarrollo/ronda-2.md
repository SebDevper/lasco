# Desarrollo · ronda 2
origen: revisiones/ronda-1.md

## Cambios
- `lasco_backend/app/horizons.py`: `soho_ephemeris_end` ahora también espera tras un fallo cuando no hay valor
  previo. Anota el plazo, y mientras dure lanza `HorizonsError` sin consultar a JPL. Con valor previo hace lo mismo
  que antes: usa ese valor y no reintenta durante 5 min. Actualicé el comentario de `RETRY_AFTER_FAILURE`: ahora la
  usan el fin y el relleno.
- `lasco_backend/app/positions.py`: reorganicé el relleno.
  - **Camino rápido**: `_fill` comprueba faltantes antes de tomar `_fill_lock` y solo lo toma si falta algo. Dentro
    del lock vuelve a comprobar por objetivo.
  - **Espera tras un fallo del relleno**: `_fill_retry_at` es global y usa el mismo plazo, `horizons.RETRY_AFTER_FAILURE`
    = 300 s. Se activa ante `httpx.HTTPError` o `HorizonsError`, y también si el reintento por «No ephemeris … after»
    vuelve a fallar. Dentro del lock se mira la espera antes de cada consulta: las peticiones que estaban en cola
    detrás de un relleno fallido terminan al instante, sin consultar.
  - **Respuesta degradada**: si JPL falló o se está en espera, se devuelve lo guardado desde el inicio de la ventana
    hasta el primer hueco, con `end` = último instante devuelto (sigue en la malla). Si no hay nada guardado para el
    inicio, se lanza `HorizonsError` y la ruta responde 502 como antes. Elegí «hasta el primer hueco» y no «todo lo
    que haya» para no devolver una línea de tiempo con agujeros. El caso normal, que falte el instante más reciente,
    da la ventana completa menos ese instante.
  - **Sin fin conocido**: si `soho_ephemeris_end` falla sin valor previo, o está en espera, no se piden vectores. Se
    usa ahora como fin y se sirve lo guardado igual que arriba, o 502.
- `lasco_backend/app/main.py`: el docstring de la ruta describe la respuesta degradada.
- `lasco_test/src/lib/positions.js`: `BackendError` gana `unreachable`. Vale `true` si no hubo respuesta del backend:
  error de red tras los reintentos, o 500/502/503/504 sin `detail`, que es lo que devuelven Vite o nginx cuando el
  backend no está. Un timeout del cliente da «el backend no respondió a tiempo», sin `unreachable`.
- `lasco_test/src/pages/Dashboard.jsx`: guarda `unreachable` en `status`.
  - Con `unreachable` muestra el comando para arrancar el backend.
  - Si no, muestra la pista neutra `# las posiciones vienen del backend lasco (/api/lasco/positions)`.
- `CLAUDE.md`, `deploy/README.md` y `lasco_backend/README.md`:
  - frase de las APIs externas corregida;
  - espera de 5 min tras fallos, camino rápido y respuesta degradada documentados;
  - texto del 502 en «Rangos» y en la tabla de la API.

## Respuesta a cada comentario
- #1 — aplicado.
  - Espera tras un fallo del relleno: 300 s, global.
  - Espera en `soho_ephemeris_end` sin valor previo.
  - Camino rápido fuera del lock.
  - Durante la espera se devuelve lo guardado hasta el primer hueco, o 502 si no hay nada.
  - Documentado en `CLAUDE.md` (viñeta `horizons.py`/`positions.py`) y en `lasco_backend/README.md`.
  - Reproduje tu escenario: con 503, falta el último instante y 5 peticiones seguidas hacen **2** consultas en total
    (antes, 10). Las 5 respuestas traen 96 instantes con `end` = el anterior.
  - Con timeouts y 5 peticiones simultáneas, se hacen 2 consultas en total y terminan las 5 en ~2 s. Ya no queda
    cola esperando el lock.
- #2 — aplicado. El comando solo sale cuando el backend no responde.
  - Con el backend en pie, el 502 trae `detail` y sale la pista neutra.
  - Mantuve el comando en el caso «no responde» también en producción, porque es lo que ya hace `BackendLine` en la
    misma consola (`# cd lasco_backend && .venv/bin/uvicorn …`). Cambiar eso sería otra decisión de interfaz, fuera
    de este cambio.
- #3 — aplicado. «el navegador no llama a ninguna API externa» en `CLAUDE.md` y `deploy/README.md`.
- #4 — aplicado. La espera de 5 min, también la del fin con valor previo, está documentada en `CLAUDE.md` y
  `lasco_backend/README.md`.
- #5 — no aplicado: fuera de alcance por decisión del orquestador.

## Verificación
- `npm run build` (Node 26): OK. Solo sale el aviso de chunk que ya había.
- `LASCO_DATA_DIR=$(mktemp -d) .venv/bin/python -c "import app.main"`: OK.
- Prueba con transporte simulado (`httpx.MockTransport` que cuenta consultas y responde bien, 503 o `ReadTimeout`
  lento). Script: `/private/tmp/claude-501/-Users-abner-workspace-super-project/a225dcd6-b253-4331-a0e6-27d230b6b540/scratchpad/r2/prueba_espera.py`.
  Se corrió con `LASCO_DATA_DIR=$(mktemp -d)`.
  1. Caché vacía y JPL bien: 1/15 da 97 instantes y 180/360 da 721, con 5 consultas (fin + 2 + 2).
  2. Falta el último instante y JPL da 503: 5 peticiones seguidas dan 96 instantes cada una (`end` 15:45) con **2**
     consultas en total, los 2 intentos de la primera.
  3. Timeouts lentos con la espera vencida: 5 simultáneas terminan en 2,0 s con 96 instantes cada una y 2 consultas.
  4. Camino rápido: mientras un relleno de 3 s tiene el lock, 180d (completo en caché) responde en 0,019 s.
  5. Fin desconocido y 503: la primera hace 2 consultas del fin y sirve lo guardado (97). Las 3 siguientes hacen 0
     consultas. Sin caché da `HorizonsError`, con 0 consultas.
  6. Al vencer las esperas con JPL sano, vuelve a consultar y rellena.
- Ruta con `TestClient` y JPL inalcanzable, caché vacía: 502 `{"detail":"no se pudo consultar JPL Horizons"}` en
  1,09 s. Repetirla da 502 en 0,02 s, sin consultar.
- Front: probé la clasificación de errores con `fetch` simulado en Node.
  - 502 con `detail` hace 3 intentos y no marca `unreachable`.
  - 502 de nginx en HTML hace 3 intentos y marca `unreachable`.
  - 500 de Vite hace 1 intento y marca `unreachable`.
  - 422 hace 1 intento y muestra su `detail`.
  - Error de red hace 3 intentos y marca `unreachable`.
- No arranqué servidores en esta ronda.
- Aviso: al principio de la ronda ejecuté una vez `python -c "import app.main"` sin `LASCO_DATA_DIR`, antes de leer
  esa indicación. Abrió `lasco_backend/data/lasco.sqlite3`, donde la tabla `positions` ya existía desde la ronda 1,
  y no modificó datos. El resto se corrió con `mktemp -d`.

## Notas para el revisor / tester
- La espera del relleno es global (no por objetivo). Si falla la Tierra después de guardar SOHO, también bloquea
  SOHO 5 min. Es más simple y JPL suele fallar para todo a la vez.
- Mientras se sirve una respuesta degradada se registra un WARNING por petición («se sirven N de M instantes»). Ese
  ritmo lo limita `lasco_api` en nginx.
- Para el tester:
  - con JPL sano el comportamiento visible no cambia;
  - en la consola, con el backend apagado, sale el comando;
  - con el backend en pie y JPL roto, por ejemplo con `HORIZONS_API` parcheado, sale la pista neutra.
