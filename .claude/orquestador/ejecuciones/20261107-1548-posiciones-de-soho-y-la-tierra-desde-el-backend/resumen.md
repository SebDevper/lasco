# Resumen · Posiciones de SOHO y la Tierra desde el backend

estado: completada · 2026-11-07 · rama `develop` · base `6209998`

## Objetivo

El navegador deja de llamar a JPL Horizons: el backend expone `GET /api/positions?days=&stepMinutes=`, pide los
vectores de SOHO (`-21`) y la Tierra (`399`) una sola vez por instante de la malla fija y los guarda en SQLite. El
front solo habla con `/api/lasco`, y se quita el proxy de Horizons de Vite y de nginx (con su filtro por `COMMAND` y
sus zonas `horizons`/`horizons_conn`).

## Tareas (plan.md)

- [x] T1 configuración (`config.py`): límites de la ruta y `LASCO_EPHEMERIS_CHECK_MINUTES`.
- [x] T2 tabla `positions` en `store.py` (se conserva la migración de `step_ms`).
- [x] T3 `horizons.py`: fin de efemérides con caché de 60 min y `fetch_vectors`.
- [x] T4 `positions.py`: ventana decidida por el servidor sobre la malla, relleno solo de lo que falta, un lock.
- [x] T5 ruta `GET /api/positions` (422 / 502) y retención propia de posiciones (182 días).
- [x] T6 front: `positions.js` reemplaza a `horizons.js`; textos de la consola.
- [x] T7 sin proxy de Horizons en `vite.config.js`, `nginx.conf.template` y `Dockerfile`.
- [x] T8 documentación: `CLAUDE.md`, `README.md`, `deploy/README.md`, `lasco_backend/README.md`.

Agregado en la revisión (comentario #1): tras un fallo de JPL no se vuelve a consultar durante 5 min y se sirve lo
que haya en caché (hasta el primer hueco); las peticiones con todo en caché no esperan al lock.

## Archivos cambiados

```
 M CLAUDE.md
 M README.md
 M deploy/README.md
 M lasco_backend/README.md
 M lasco_backend/app/config.py
 M lasco_backend/app/horizons.py
 M lasco_backend/app/main.py
 M lasco_backend/app/store.py
 M lasco_backend/app/sync.py
 M lasco_test/Dockerfile
 M lasco_test/nginx.conf.template
 D lasco_test/src/lib/horizons.js
 M lasco_test/src/pages/Dashboard.jsx
 M lasco_test/vite.config.js
?? lasco_backend/app/positions.py
?? lasco_test/src/lib/positions.js
```

## Rondas

| etapa | rondas | resultado |
|---|---|---|
| plan | 1 | 8 tareas, aprobado por el usuario |
| desarrollo | 2 | ronda 1: T1–T8; ronda 2: comentarios #1–#4 |
| revisión | 2 | ronda 1: CAMBIOS (1 importante, 4 menores); ronda 2: APROBADO |
| pruebas | 1 | APROBADO: 36/36 casos (build, API, fallos de JPL simulados, navegador, Docker/nginx); limpieza ok |

## Quedó pendiente (opcional)

- #5 `.claude/agents/revisor.md` sigue citando `floorToStep` (ahora es `floor_to_step` en el backend). Es
  configuración del orquestador; se dejó fuera de esta ejecución.
- #6 si falla la consulta del fin con un valor anterior, la misma petición vuelve a pedir vectores (~82 s; nginx corta
  a los 60 s). Afecta a un visitante una vez; después rige la espera de 5 min.
- #7 la espera tras un fallo del relleno se anota fuera del lock; hoy es correcto, pero frágil si se agrega un `await`
  en ese `except`.
- #8 con el fin cacheado viejo y peticiones simultáneas puede haber más consultas a JPL de las necesarias (6 en vez de
  3 con 4 peticiones). Raro y acotado.
- Observaciones del tester: en dev `StrictMode` hace 2 peticiones de posiciones al montar (como antes); con un 503 de
  JPL el log del backend guarda la URL completa de Horizons. No se probó la variante de producción local (puerto 8081).
- La primera importación del backend durante la ejecución creó la tabla `positions` vacía en
  `lasco_backend/data/lasco.sqlite3` (es lo que hará el backend al arrancar; ningún otro dato cambió).

## Cómo probarlo a mano

```bash
cd lasco_backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
curl 'http://127.0.0.1:8000/api/positions?days=1&stepMinutes=15' | head -c 400   # 97 instantes
curl -i 'http://127.0.0.1:8000/api/positions?days=30&stepMinutes=15'             # 422 (más de 800 instantes)
cd lasco_test && npm run dev    # http://localhost:5173: en la pestaña de red no aparece /api/horizons
docker compose up -d --build    # http://localhost:8080; /api/horizons ya no llega a JPL
```
