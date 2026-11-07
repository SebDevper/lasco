# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Panel web que muestra el Sol en 3D, la posición real de la nave SOHO (que lleva el coronógrafo LASCO) en su órbita
halo alrededor de L1, y las imágenes LASCO C2/C3 superpuestas tal como las veía la nave. Dos partes:

- `lasco_test/` — front: Vite 8 + React 18 + three.js (sin TypeScript, sin router).
- `lasco_backend/` — backend Python (FastAPI + httpx + SQLite) que descarga las imágenes LASCO y las sirve desde disco.

La interfaz y los comentarios del código están en español. El usuario se comunica en español.

## Comandos

```bash
# Front (Node 26 vía nvm; lasco_test/.nvmrc). En shells no interactivos: export PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"
cd lasco_test
npm run dev        # http://localhost:5173
npm run build      # única verificación automática disponible: no hay tests ni linter configurados
npm run preview

# Backend
cd lasco_backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000   # al arrancar sincroniza la ventana por defecto
.venv/bin/python -m app sync [--hours 24] [--until ephemeris|now|ISO]   # sincronizar sin servidor
```

Para verificar cambios visuales hay que levantar ambos servicios y mirar la página en el navegador (`npm run build`
solo detecta errores de compilación). Detener servicios por puerto: `lsof -ti:5173,8000 -sTCP:LISTEN | xargs kill`.

### Contenedores (Docker Compose; en esta máquina el motor es Colima: `colima start`)

```bash
docker compose up -d --build     # http://localhost:8080 (front con nginx) + backend en la red interna
docker compose logs -f backend   # progreso de las descargas
docker compose exec backend python -m app sync --hours 48
docker compose down              # las imágenes quedan en el volumen lasco_data (down -v las borra)
```

En contenedores no hay servidor de Vite: `lasco_test/nginx.conf.template` hace lo mismo que el proxy de
`vite.config.js` (`/api/horizons` → JPL, `/api/lasco/` → backend). Al cambiar un proxy, cambiar ambos. Solo nginx
(lo que se publica) tiene además la parte de seguridad: deja pasar a Horizons solo `COMMAND` `'-21'`/`'399'` y GET,
límites por IP (`limit_req`: API 10/s, imágenes 100/s en cola, Horizons 30/min y 3 conexiones; 429) y toma la IP real
de `X-Forwarded-For` solo desde redes privadas (Caddy). Si el front pide algo nuevo a Horizons o hace más peticiones,
revisar esos límites.

Producción (VM Always Free de Oracle): `deploy/README.md`. `docker-compose.prod.yml` agrega Caddy (HTTPS con
`SITE_ADDRESS`) y quita el puerto 8080 del front; `deploy/subir.sh usuario@ip` sube la rama `main` con `git archive`
y escribe `~/lasco/.env` (`COMPOSE_FILE` + `~/lasco.env`). Probar en local con `SITE_ADDRESS=:80 HTTP_PORT=8081`
(Colima solo comparte la carpeta personal: nada de bind mounts desde /tmp).

### Orquestador de agentes

`/orquestar <solicitud>` (skill en `.claude/skills/orquestar/`) ejecuta un cambio con subagentes
(`.claude/agents/`): planificador → desarrollador ⇄ revisor → tester, volviendo a desarrollo si algo falla. Cada
ejecución queda registrada en `.claude/orquestador/ejecuciones/` (bitácora, plan, revisiones, pruebas). Ver
`.claude/orquestador/README.md`.

## Arquitectura

### Flujo de datos

1. **Posiciones** — `src/lib/horizons.js` pide a JPL Horizons vectores heliocéntricos (eclíptica J2000, km) de SOHO
   (`-21`) y la Tierra (`399`). Horizons no tiene CORS: va por el proxy de Vite `/api/horizons` (`vite.config.js`),
   que solo existe en `dev`/`preview`. Las efemérides de SOHO terminan en la última predicción publicada (suele ir
   ~1 día atrás); el cliente detecta el error "No ephemeris … after" y reintenta terminando en ese límite.
2. **Geometría** — `src/lib/orbit.js` `describeSample()` construye el sistema rotatorio Sol→Tierra (x), norte de la
   eclíptica (z), y calcula L1 (≈ r·(μ/3)^(1/3)) y todas las métricas que muestra el panel. Todo lo demás consume
   estos objetos "sample".
3. **Imágenes** — el front **no** habla con Helioviewer. `src/lib/lasco.js` solo usa el backend vía el proxy
   `/api/lasco` → `127.0.0.1:8000/api`. «actualizar» hace `POST /api/sync` con el rango visible, sigue
   `/api/status` cada 2 s y al terminar carga las imágenes. Solo se usan imágenes del backend para instantes dentro de
   sus ventanas `coverage`.
4. **Detalle al pausar** — `useLascoDetails()` (solo con el timelapse en pausa) pide al backend el encabezado FITS
   de cada imagen (`/api/images/{id}/header`) y los eventos ±6 h (`/api/events`: CME de CACTus y fulguraciones GOES
   del HEK). `LascoImages.jsx` dibuja sobre la imagen el sector de cada CME visible: con el norte solar arriba, el
   ángulo de posición crece hacia el este (izquierda), punto = (cx − r·sen AP, cy − r·cos AP).
5. **Timelapse** — `prefetchFrames()` guarda en memoria (Map de blob URLs a nivel de módulo) una imagen de 512 px por
   instante y coronógrafo; durante la reproducción se usan esas, y al pausar `useLascoImages` carga la de 1024 px.
   Ojo: HMR de `lasco.js` reinicia esos Map.

### Rangos (`RANGES` en `src/pages/Dashboard.jsx`)

`24h` usa pasos de 15 min (cadencia de LASCO ~12–20 min); `30d/90d/180d` pasos de 6 h. Todos terminan en el fin de
las efemérides (o ahora) **redondeado hacia abajo a un múltiplo del paso en UTC** (`floorToStep` en `horizons.js`:
6 h → 00/06/12/18 UTC), así que los instantes de distintos rangos coinciden y la malla no cambia cada minuto. El
backend solo acepta esa malla en ventanas largas: si se moviera, cada «actualizar» bajaría ~1.400 imágenes nuevas.
Los tiempos de Horizons se redondean al segundo (el JD en coma flotante deja 01:56:59.9998).

`POST /api/sync` es público y valida la ventana (`_check_window` en `main.py`, límites en `config.py`): nada en el
futuro (correría el corte de la retención y borraría todo), todas las imágenes solo en las últimas 120 h y ≤ 48 h,
muestreadas con paso múltiplo de 360 en la malla fija y ≤ 800 instantes, y 30 s de espera entre sincronizaciones
(429 con `Retry-After`; el front espera y reintenta una vez).

### Backend (`lasco_backend/app/`)

- `sync.py` tiene dos modos: ventanas ≤ `ALL_IMAGES_MAX_HOURS` (48 h) bajan **todas** las imágenes (listadas con
  `getJPX?verbose=true`); ventanas más largas con `stepMinutes` bajan solo la más cercana a cada instante (tabla
  `samples`). Una sincronización a la vez (409 si hay otra). Reintentos ×3 con timeout: Helioviewer a veces deja
  peticiones colgadas.
- Retención: al final de cada `Syncer.run` (botón «actualizar», arranque o CLI) `Store.prune()` borra lo anterior a
  (fin de la ventana más reciente − `LASCO_RETENTION_DAYS` (180) − 2 días): imágenes y sus archivos, encabezados,
  `samples`, eventos, y recorta `coverage` (las muestreadas, alineadas a su malla). No borra una imagen anterior al
  corte si un instante muestreado posterior todavía la usa. `run()` recorta el inicio de la ventana al mismo corte para no
  descargar lo que se borraría. Si se agrega un rango más largo en `RANGES`, subir el valor.
- `store.py`: SQLite (`images`, `coverage` con `step_ms`, `samples`, `headers`, `events`, `event_days`) + JPG en
  `data/images/{c2,c3}/{id}_{512|1024}.jpg`.
  Tiene una migración ligera en `Store.__init__`; mantenerla al tocar el esquema.
- `hek.py` / `events.py`: eventos del HEK (LMSAL) cacheados por día UTC; los últimos 3 días se vuelven a consultar
  cada hora (el HEK revisa sus catálogos). Las fulguraciones repetidas entre catálogos se fusionan (clase de SWPC,
  posición de SDO). `helioviewer.jp2_header()` resume el encabezado FITS.
- Ventana por defecto: 24 h terminando en el fin de las efemérides de SOHO (`LASCO_SYNC_UNTIL=ephemeris`), para
  coincidir con la pestaña 24h. Configuración por variables de entorno en `config.py` (ver `README.md`).

### Escena 3D (`src/components/SunScene.jsx`)

- `buildScene()` es three.js imperativo; el componente React solo le pasa props vía `update`, `goTo`, `setLasco`,
  `setMix`, `setFilter`.
- **Escala no real a propósito**: radio solar 5, 1 UA = 70, entorno de la Tierra ampliado con `NEAR_SCALE`. Eclíptica
  → escena con `toScene` (y arriba). Al cambiar de instante, la cámara rota alrededor del Sol con la Tierra.
- **Vista LASCO**: la cámara mira al Sol desde la dirección de SOHO con `camera.up` = polo norte solar (IAU), porque
  Helioviewer entrega imágenes con el norte solar arriba. La imagen se pone en un plano con mezcla aditiva escalado
  con `rsunPx` y desplazado con el píxel de referencia (`centerX/centerY`, origen arriba-izquierda) para que el radio
  solar de la imagen coincida con el Sol 3D. OrbitControls se desactiva en ese modo.
- Las etiquetas son `CSS2DObject`: **no heredan la visibilidad del padre**, por eso se ocultan explícitamente.
- Filtros de dibujo (`src/lib/filters.js`: ASCII y punteado, en verde o a color): canvas 2D entre el WebGL y las
  etiquetas; muestrea el canvas WebGL justo después de `renderer.render` en el mismo frame (no hay
  `preserveDrawingBuffer`). El punteado acumula los puntos en `Path2D` (uno por tono) y rellena una vez por tono.

### UI / estilo

- Estética de terminal: cada bloque es un `Pane` (`src/components/Pane.jsx`) con barra `[n] título`, línea `$ comando`
  y comentarios `# …`; estados como `[ok]`, `[!]`, `[error]`, `[sync]`. Mantener ese tono en textos nuevos.
- Colores y tipografía son tokens CSS en `src/index.css` (`--green`, `--amber`, `--cyan`, `--font` JetBrains Mono).
- Evitar saltos de layout durante la reproducción: los textos que cambian por instante tienen alto fijo (p. ej. el
  aviso de hueco `GapBadge` siempre ocupa su lugar con `visibility: hidden`; la consola reserva 4 líneas).
- Las gráficas son SVG a mano (`HaloChart`, `DistanceChart`, helpers en `src/lib/chart.js`), una sola serie, con
  tooltip y clic para seleccionar instante. Fechas siempre en UTC con `fmtDateTime` (`2026-11-02 23:50 UTC`).
