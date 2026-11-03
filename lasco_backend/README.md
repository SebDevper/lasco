# lasco_backend

Backend en Python (FastAPI) que descarga y guarda en disco las imágenes de los coronógrafos LASCO C2 y C3
(SOHO) desde [Helioviewer](https://helioviewer.org), para que el front (`../lasco_test`) no tenga que
descargarlas cada vez.

- El front no descarga nada de Helioviewer: su botón «actualizar» le pide al backend que sincronice el rango
  visible (`POST /api/sync`), sigue el progreso en `/api/status` y después lee las imágenes del backend.
- Ventanas de hasta 48 h: descarga **todas** las imágenes publicadas. Ventanas más largas (cuando se indica
  `stepMinutes`): solo la más cercana a cada instante de la línea de tiempo (180 días completos serían
  ~26.000 imágenes; muestreados cada 6 h, ~1.400).
- Cada imagen se guarda en 512 px (timelapse) y 1024 px (vista en pausa), con el norte solar arriba.
- Guarda los JPG en `data/images/{c2,c3}/` y un índice SQLite en `data/lasco.sqlite3`.
- Lo ya descargado no se vuelve a pedir.

## Instalación

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Uso

```bash
# Servidor (el front lo usa a través del proxy de Vite en /api/lasco)
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
| `LASCO_CONCURRENCY` | `6` | descargas en paralelo |
| `LASCO_REQUEST_TIMEOUT` | `25` | segundos por petición (se reintenta hasta 3 veces) |
| `LASCO_DATA_DIR` | `./data` | carpeta de imágenes e índice |

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/status` | progreso de la sincronización, imágenes en disco y ventanas completas |
| GET | `/api/images?start=&end=[&instrument=c2\|c3]` | imágenes guardadas en un rango |
| GET | `/api/images/closest?instrument=&date=` | imagen guardada más cercana a una fecha |
| GET | `/api/images/{id}/header` | encabezado FITS resumido (exposición, filtro, campo, orientación de SOHO, calidad); se cachea |
| GET | `/api/events?start=&end=` | CME (CACTus) y fulguraciones (GOES) del HEK que se solapan con la ventana (máx. 7 días); caché por día |
| POST | `/api/sync` | sincroniza en segundo plano; cuerpo `{"start", "end", "stepMinutes"}` o `{"hours", "until"}` (409 si ya hay una en curso) |
| GET | `/api/files/{c2\|c3}/{id}_{512\|1024}.jpg` | archivos de imagen |

Cada imagen incluye, por tamaño, el radio y el centro del Sol en píxeles (`rsunPx`, `centerX`, `centerY`), que el
front usa para alinearla con el Sol 3D.

`coverage` en `/api/status` lista las ventanas ya sincronizadas; el front usa imágenes del backend para los
instantes dentro de ellas. Si el backend está apagado, el panel funciona sin imágenes LASCO.
