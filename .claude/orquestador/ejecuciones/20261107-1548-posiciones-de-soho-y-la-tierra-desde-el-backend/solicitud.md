# Posiciones de SOHO y la Tierra desde el backend

- inicio: 2026-11-07 15:48:05 UTC
- rama: `develop`
- commit base: `6209998230d3e9e8605b70d34fc5946764deed69`

## Estado de git al empezar

```
(limpio)
```

## Solicitud del usuario

Pregunta original del usuario (2026-11-07):

> Estoy revisando el despliegue en oracle y en el front menciona un nginx con jpl horizons. Por qué está esto si toda
> la información ahora la obtiene el backend? Puedes revisar?

Tras la explicación del orquestador (ver contexto), el usuario respondió «Perfecto» y luego «ahora ejecuta el cambio».

Solicitud resumida: mover la obtención de posiciones de SOHO y la Tierra (JPL Horizons) del front al backend: el
backend expone un endpoint de posiciones con caché en SQLite sobre la malla fija de instantes, el front deja de llamar
a /api/horizons y usa solo /api/lasco, y se quita el proxy de Horizons de vite.config.js y de nginx.conf.template (con
sus límites), actualizando la documentación.

## Contexto de la conversación

Lo que se comprobó y propuso antes de la ejecución (propuesta aceptada por el usuario):

- Hoy el front (`lasco_test/src/lib/horizons.js`, `fetchSohoAndEarth()`, llamado en `Dashboard.jsx` al cambiar de
  rango o «actualizar») pide a `/api/horizons` los vectores (posición + velocidad, eclíptica J2000, km, centro Sol)
  de SOHO (`-21`) y la Tierra (`399`) para todo el rango visible. Pasa por el proxy de Vite (`vite.config.js`) en
  desarrollo y por `nginx.conf.template` (`location = /api/horizons`, con `map $arg_COMMAND`, `limit_req
  zone=horizons` 30/min y `limit_conn` 3) en contenedores/producción.
- El backend solo consulta Horizons en `lasco_backend/app/horizons.py` (`soho_ephemeris_end()`, usado en
  `sync.py` para fijar el fin de la ventana). No guarda ni sirve posiciones.
- Propuesta: endpoint del estilo `GET /api/positions?days=…&step=…` en el backend que pida los vectores a Horizons y
  los cachee en SQLite (la malla de instantes es fija, `floorToStep`, así que la caché se aprovecha bien), con
  validación de la ventana como `_check_window`. Beneficios: nginx deja de ser un proxy abierto a JPL (se borra el
  bloque de Horizons: `map`, `limit_req`, `limit_conn`), muchas menos consultas a JPL (por instante nuevo, no por
  visitante y cambio de rango), y el front solo habla con `/api/lasco`.
- Archivos que se esperaba tocar: `horizons.js`, `Dashboard.jsx`, backend (endpoint, tabla, validación) y ambos
  proxies, más la documentación (`CLAUDE.md`, `README.md`, `deploy/README.md`).
- El comportamiento visible debe mantenerse: mismos rangos (`RANGES`), mismo fin de efemérides (incluido el
  reintento cuando Horizons responde «No ephemeris … after»), mismos textos de estado en el panel salvo lo que ya no
  aplique.

## Aclaraciones

<!-- preguntas al usuario y sus respuestas, con fecha -->
