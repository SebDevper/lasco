# Revisión · ronda 2
veredicto: APROBADO

## Comentarios de la ronda anterior
- **#1 — resuelto.** Lo comprobé con un `httpx.MockTransport` y una base en `mktemp -d`:
  - Hay espera de 300 s tras un fallo del relleno (`_fill_retry_at`). También para el fin sin valor previo: lanza
    `HorizonsError` sin consultar mientras dura.
  - Camino rápido sin lock cuando no falta nada.
  - 6 peticiones simultáneas con JPL respondiendo 503 lento hacen **2** consultas en total (antes, una por petición
    y por intento). Las que esperaban el lock terminan al instante.
  - El orden es correcto: el lock se suelta en el `__aexit__` sin ceder el loop y la espera se anota antes de que
    corra el siguiente en cola (ver #7, opcional).
  - Está documentado en `CLAUDE.md` y `lasco_backend/README.md`.
- **#2 — resuelto.** El comando para arrancar el backend sale solo con `unreachable`: red, 500 de Vite o 502/503/504
  sin `detail`. Con el backend en pie, el 502 trae `detail` y la pista es neutra. Acepto que se mantenga el comando
  en producción, como ya hace `BackendLine`.
- **#3 — resuelto.** «el navegador no llama a ninguna API externa» en `CLAUDE.md:45` y `deploy/README.md:182`.
- **#4 — resuelto.** La espera de 5 min, la del fin y la del relleno, está documentada en `CLAUDE.md:122-125` y
  `lasco_backend/README.md:14-17`.
- **#5 — fuera de alcance (orquestador).**

## Comentarios nuevos
### #6 [menor] `lasco_backend/app/positions.py:88-98` — si el fin falla con valor previo, la misma petición vuelve a probar los vectores
Cuando vence el TTL del fin y JPL está caído, `soho_ephemeris_end` tarda unos 41 s y devuelve el valor anterior, sin
lanzar error. Si además falta un instante, `_fill` vuelve a consultar a JPL: otros 41 s. En total unos 82 s, así que
nginx corta con 504 a los 60 s. El front reintenta y para entonces ya está la espera, así que solo un visitante, una
vez, espera ~1 min. Es opcional: que `soho_ephemeris_end` informe que acaba de fallar (o que comparta el instante de
fallo con `_fill_retry_at`) y que `positions_window` pase directo a la respuesta degradada.

### #7 [menor] `lasco_backend/app/positions.py:106-109` — la espera del relleno se anota fuera del lock
Que las peticiones en cola no consulten depende de que no haya ningún `await` entre que `_fill` suelta `_fill_lock`
(por la excepción) y la asignación de `_fill_retry_at`. Hoy se cumple. Pero si algún día se agrega algo asíncrono en
ese `except` (un `to_thread`, un log asíncrono), el siguiente en cola volvería a consultar a JPL sin que nada lo
avise. Es opcional: anotar la espera dentro de `_fill`, con un `try/except` alrededor de `fetch_vectors` y bajo el
lock, o al menos dejar un comentario.

### #8 [menor] `lasco_backend/app/positions.py:100-105` — peticiones simultáneas cuando el fin en caché quedó viejo
Lo simulé con el fin en caché en «hasta ahora» y el límite real 3 h antes, con 4 peticiones simultáneas. Hicieron 6
consultas en vez de 3. Cada petición que esperaba el lock con el fin viejo repite una consulta de SOHO que falla con
«No ephemeris … after» y luego recalcula. Está acotado por la concurrencia y es raro: solo pasa cuando el fin en caché
es «hasta ahora» y la predicción publicada termina dentro del TTL. Es opcional: dentro del lock, recalcular `end` si
`note_ephemeris_limit` cambió el fin mientras se esperaba.

## Revisado sin observaciones
- **Respuesta degradada**: devuelve lo guardado desde el inicio de la ventana hasta el primer hueco, con `end` = el
  último instante devuelto.
  - Ese `end` está en la malla, porque es un instante de `range(start_ms, …, step_ms)`.
  - En el front, `ephemerisEnd` y «último dato» muestran ese instante.
  - `loadImages` manda a `POST /api/sync` un inicio y un fin en la malla. En 30/90/180d la ventana sigue siendo de
    más de 48 h salvo con una caché casi vacía; en ese caso el sync da 422 y se ve como error de sync, sin romper
    nada.
  - Un hueco a mitad de ventana corta lo más reciente (simulado: 40 de 97, `end` 14 h antes). Pero `_fill` siempre
    pide `[primer faltante, último faltante]` de una vez, así que no deja huecos intermedios y en la práctica el corte
    es «hasta lo último guardado contiguo». Acepto la decisión.
  - Si no hay nada guardado para el inicio, responde 502 (simulado con 180d durante la espera).
  - El caso normal con JPL sano no cambia.
- **Espera común para SOHO y la Tierra**: si falla la Tierra después de guardar SOHO, la respuesta solo incluye
  instantes con los dos objetivos. Bloquear los dos 5 min es razonable.
- **Atajo sin lock**: `_missing` y `save_positions` son síncronos, así que no se intercalan con otras corrutinas.
  Dentro del lock se vuelve a comprobar por objetivo y la espera. Las condiciones de carrera que encontré son
  benignas: `complete` en falso solo recorta en huecos que no existen; la de #8 es opcional.
- **`soho_ephemeris_end`**: con espera y valor previo devuelve el valor, con espera y sin valor lanza el error sin
  consultar, y `default_window` captura `HorizonsError`.
- **Front**: `positions.js` clasifica `unreachable` y trata el timeout aparte. `Dashboard.jsx` guarda `unreachable`
  en `status`. El texto y el tono son correctos.
- **Documentación**: `CLAUDE.md`, `README.md`, `deploy/README.md`, `lasco_backend/README.md` y el docstring de
  `main.py` coinciden con el código.
- **Lo ya aprobado en la ronda 1 sigue igual**: validación de la ruta, malla, `Store` y su migración, retención,
  proxies Vite/nginx.
- **Verificaciones**: `npm run build` OK (solo el aviso de chunk que ya había). `LASCO_DATA_DIR=$(mktemp -d)
  python -c "import app.main"` OK. Las simulaciones se hicieron con un directorio temporal, ya borrado.

Opcionales pendientes: #6, #7, #8.
