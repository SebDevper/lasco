# lasco_backend

Backend en Python (FastAPI) que descarga y guarda en disco las imágenes de los coronógrafos LASCO C2 y C3
(SOHO) desde [Helioviewer](https://helioviewer.org), para que el front (`../lasco_test`) no tenga que
descargarlas cada vez. También le sirve las posiciones de SOHO y la Tierra, que pide a
[JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) y guarda en SQLite: el front solo habla con este backend.

- **Posiciones** (`GET /api/positions?days=&stepMinutes=`): vectores heliocéntricos (eclíptica J2000, km y km/s) de
  SOHO (`-21`) y la Tierra (`399`) en la malla fija de instantes (múltiplos del paso desde 1970-01-01 UTC). El fin
  lo decide el backend: el último instante con efemérides de SOHO (o ahora) redondeado hacia abajo al paso. Cada
  instante se pide a JPL una sola vez (una consulta por objetivo con lo que falte, nunca en paralelo) y queda en la
  tabla `positions`; el fin de las efemérides se vuelve a consultar como mucho cada hora
  (`LASCO_EPHEMERIS_CHECK_MINUTES`). Si JPL dice «No ephemeris … after» antes de lo esperado, se corrige el fin y se
  reintenta una vez. Si una consulta a JPL falla (fin o posiciones), no se vuelve a consultar en 5 minutos: el fin
  usa el último valor conocido y la ruta devuelve lo guardado desde el inicio de la ventana hasta el primer instante
  que falte (`end` es el último devuelto), o 502 si no hay nada guardado. Así, con JPL caído o limitando la IP del
  servidor, no se le insiste. Las posiciones tienen su propia retención: se borran las anteriores a ahora − 182 días
  (`LASCO_POSITIONS_MAX_DAYS` + 2), al terminar cada sincronización.
- El front no descarga nada de Helioviewer: su botón «actualizar» le pide al backend que sincronice el rango
  visible (`POST /api/sync`), sigue el progreso en `/api/status` y después lee las imágenes del backend.
- Ventanas de hasta 48 h: descarga **todas** las imágenes publicadas. Ventanas más largas (cuando se indica
  `stepMinutes`): solo la más cercana a cada instante de la línea de tiempo (180 días completos serían
  ~26.000 imágenes; muestreados cada 6 h, ~1.400).
- Cada imagen se guarda en 512 px (timelapse) y 1024 px (vista en pausa), con el norte solar arriba.
- Guarda los JPG en `data/images/{c2,c3}/` y un índice SQLite en `data/lasco.sqlite3`.
- Lo ya descargado no se vuelve a pedir.
- **Retención**: al terminar cada sincronización (el botón «actualizar» del panel, la del arranque o
  `python -m app sync`) se borra lo anterior a `LASCO_RETENTION_DAYS` (180, el rango más largo del panel) + 2 días
  de margen, contados desde el fin de la ventana sincronizada más reciente: imágenes, encabezados, instantes
  muestreados, eventos y el tramo de las ventanas que queda fuera. Así el disco no crece sin límite.
  Tampoco se descarga lo que quedaría fuera: si se pide una ventana más antigua, se recorta al límite.

## Instalación

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Uso

```bash
# Servidor (el front lo usa a través del proxy de Vite en /api/lasco: sin él, el panel no carga)
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# Solo sincronizar, sin servidor
.venv/bin/python -m app sync                 # últimas 24 h (configuración por defecto)
.venv/bin/python -m app sync --hours 48      # otra duración
.venv/bin/python -m app sync --until now     # terminando ahora
```

Al arrancar, el servidor sincroniza en segundo plano la ventana por defecto.

### Ventana por defecto

Las últimas `LASCO_SYNC_HOURS` horas (24) **terminando en el último instante con posición de SOHO publicada
por JPL Horizons** (`LASCO_SYNC_UNTIL=ephemeris`). Es el mismo rango que muestra la pestaña «24h» del panel.
Como JPL publica la posición con cierto retraso, esta ventana puede terminar horas antes de las imágenes más
recientes; con `LASCO_SYNC_UNTIL=now` termina ahora.

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `LASCO_SYNC_HOURS` | `24` | duración de la ventana |
| `LASCO_SYNC_UNTIL` | `ephemeris` | fin de la ventana: `ephemeris`, `now` o una fecha ISO |
| `LASCO_SYNC_ON_START` | `1` | sincronizar al arrancar el servidor |
| `LASCO_ALL_IMAGES_MAX_HOURS` | `48` | hasta esta duración se bajan todas las imágenes; por encima, una por instante |
| `LASCO_RETENTION_DAYS` | `180` | días que se conservan (+2 de margen) desde la ventana más reciente; `0` = no borrar |
| `LASCO_SYNC_ALL_RECENT_HOURS` | `120` | `POST /api/sync`: todas las imágenes solo para ventanas que empiecen en estas últimas horas |
| `LASCO_SYNC_MIN_STEP_MINUTES` | `360` | `POST /api/sync`: el paso de las ventanas largas debe ser múltiplo de este valor, en su malla UTC |
| `LASCO_SYNC_MAX_SAMPLES` | `800` | `POST /api/sync`: máximo de instantes por coronógrafo en una ventana larga |
| `LASCO_SYNC_COOLDOWN_SECONDS` | `30` | `POST /api/sync`: espera entre el fin de una sincronización y la siguiente |
| `LASCO_POSITIONS_MAX_DAYS` | `180` | `GET /api/positions`: máximo de días (el rango más largo del panel); también fija la retención de las posiciones (+2 días) |
| `LASCO_POSITIONS_MAX_SAMPLES` | `800` | `GET /api/positions`: máximo de instantes por petición |
| `LASCO_EPHEMERIS_CHECK_MINUTES` | `60` | cada cuánto, como mucho, se vuelve a consultar a JPL el fin de las efemérides de SOHO |
| `LASCO_CONCURRENCY` | `6` | descargas en paralelo |
| `LASCO_REQUEST_TIMEOUT` | `25` | segundos por petición (se reintenta hasta 3 veces) |
| `LASCO_DATA_DIR` | `./data` | carpeta de imágenes e índice |

### Límites de la sincronización

`POST /api/sync` queda abierto a quien tenga la dirección del panel, y cada sincronización descarga de Helioviewer y
escribe en disco. Por eso solo acepta las ventanas que pide el panel (la sincronización del arranque y la CLI no
tienen límites):

- nada que termine en el futuro (una ventana así correría el corte de la retención y borraría las imágenes reales);
- todas las imágenes: ventanas de hasta 48 h que empiecen dentro de las últimas 120 h;
- muestreadas: paso múltiplo de 360 min, inicio y fin en la malla fija de 00/06/12/18 UTC (si la malla pudiera
  correrse, cada petición bajaría ~1.400 imágenes nuevas) y como mucho 800 instantes;
- 30 s entre el fin de una sincronización y la siguiente (429 con `Retry-After`).

Las demás rutas que consultan servicios externos también están acotadas: `/api/events` solo acepta ventanas de
hasta 48 h dentro de los últimos 185 días (`LASCO_EVENTS_MAX_WINDOW_HOURS`, `LASCO_EVENTS_MAX_AGE_DAYS`),
`/api/images/{id}/header` solo imágenes que el backend tiene y `/api/positions` solo `days` entero entre 1 y 180,
`stepMinutes` 15 o 360 y como mucho 800 instantes (24h cada 15 min son 97; 180d cada 6 h, 721; 30d cada 15 min,
2.881, se rechaza), sin poder elegir el fin. Los errores de JPL, Helioviewer y el HEK se registran en el log; las
respuestas solo dicen qué servicio falló. No se publican `/docs` ni `/openapi.json`. Los límites por IP
están en el nginx del front (`lasco_test/nginx.conf.template`).

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/status` | progreso de la sincronización, imágenes en disco y ventanas completas |
| GET | `/api/images?start=&end=[&instrument=c2\|c3]` | imágenes guardadas en un rango |
| GET | `/api/images/closest?instrument=&date=` | imagen guardada más cercana a una fecha |
| GET | `/api/images/{id}/header` | encabezado FITS resumido (exposición, filtro, campo, orientación de SOHO, calidad); se cachea. 404 si el backend no tiene esa imagen |
| GET | `/api/positions?days=&stepMinutes=` | posiciones de SOHO y la Tierra de los últimos `days` días (1–180) cada `stepMinutes` (15 o 360), hasta el fin de las efemérides de SOHO redondeado al paso. Respuesta `{"end", "stepMinutes", "days", "samples": [{"time", "soho": [x, y, z, vx, vy, vz], "earth": […]}]}` (km, km/s). Si JPL falla, lo guardado hasta el primer hueco. 422 fuera de los límites, 502 si falla JPL y no hay nada guardado |
| GET | `/api/events?start=&end=` | CME (CACTus) y fulguraciones (GOES) del HEK que se solapan con la ventana (máx. 48 h, dentro de los últimos 185 días); caché por día |
| POST | `/api/sync` | sincroniza en segundo plano; cuerpo `{"start", "end", "stepMinutes"}` o `{"hours", "until"}`. Pública: 422 si la ventana no es de las que pide el panel (ver «Límites de la sincronización»), 409 si ya hay una en curso, 429 (`Retry-After`) si la anterior acaba de terminar |
| GET | `/api/files/{c2\|c3}/{id}_{512\|1024}.jpg` | archivos de imagen |

Cada imagen incluye, por tamaño, el radio y el centro del Sol en píxeles (`rsunPx`, `centerX`, `centerY`), que el
front usa para alinearla con el Sol 3D.

`coverage` en `/api/status` lista las ventanas ya sincronizadas; el front usa imágenes del backend para los
instantes dentro de ellas. Si el backend está apagado, el panel no carga: no hay posiciones ni imágenes.
