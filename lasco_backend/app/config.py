"""Configuración del backend (variables de entorno con valores por defecto)."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("LASCO_DATA_DIR", BASE_DIR / "data"))
IMAGES_DIR = DATA_DIR / "images"
DB_PATH = DATA_DIR / "lasco.sqlite3"

# Coronógrafos y su id de fuente en Helioviewer.
INSTRUMENTS = {"c2": 4, "c3": 5}

# Tamaños guardados por imagen: 512 px para el timelapse, 1024 px para la vista en pausa.
SIZES = (512, 1024)

# Ventana que se sincroniza al arrancar el servidor (o con `python -m app sync` sin argumentos).
SYNC_HOURS = float(os.environ.get("LASCO_SYNC_HOURS", "24"))
# Dónde termina la ventana: "ephemeris" = último instante con posición de SOHO publicada por JPL
# (lo que muestra el panel), "now" = ahora.
SYNC_UNTIL = os.environ.get("LASCO_SYNC_UNTIL", "ephemeris")
SYNC_ON_START = os.environ.get("LASCO_SYNC_ON_START", "1") == "1"

# Ventanas de hasta estas horas se sincronizan con TODAS las imágenes publicadas. En ventanas más largas
# (si se indica un paso) solo se guarda la imagen más cercana a cada instante: 180 días completos serían
# ~26.000 imágenes, mientras que muestreados cada 6 h son ~1.400.
ALL_IMAGES_MAX_HOURS = float(os.environ.get("LASCO_ALL_IMAGES_MAX_HOURS", "48"))

# Retención: al terminar cada sincronización se borra lo anterior a (fin de la ventana más reciente − estos días),
# es decir, lo que ya no cabe en el rango más largo del panel (180d). 0 = no borrar nunca.
RETENTION_DAYS = float(os.environ.get("LASCO_RETENTION_DAYS", "180"))
# Margen extra: si una ventana termina "now" y no en el fin de las efemérides (que va ~1 día atrás), el primer
# día del rango de 180d del panel no debe borrarse y volver a descargarse en cada sincronización.
RETENTION_MARGIN_DAYS = 2

# Límites de POST /api/sync, que queda abierto a cualquiera (las sincronizaciones internas, al arrancar o por la
# CLI, no los aplican). Cubren lo que pide el panel: 24h con todas las imágenes y 30/90/180d cada 6 h.
#   - todas las imágenes: solo ventanas que empiecen dentro de las últimas SYNC_ALL_RECENT_HOURS horas (las
#     efemérides de SOHO, donde termina la pestaña 24h, suelen ir ~1 día atrás);
#   - muestreadas: paso múltiplo de SYNC_MIN_STEP_MINUTES, inicio y fin en esa malla fija (00/06/12/18 UTC con
#     360) y como mucho SYNC_MAX_SAMPLES instantes;
#   - SYNC_COOLDOWN_SECONDS entre el fin de una sincronización y el inicio de la siguiente.
SYNC_ALL_RECENT_HOURS = float(os.environ.get("LASCO_SYNC_ALL_RECENT_HOURS", "120"))
SYNC_MIN_STEP_MINUTES = float(os.environ.get("LASCO_SYNC_MIN_STEP_MINUTES", "360"))
SYNC_MAX_SAMPLES = int(os.environ.get("LASCO_SYNC_MAX_SAMPLES", "800"))
SYNC_COOLDOWN_SECONDS = float(os.environ.get("LASCO_SYNC_COOLDOWN_SECONDS", "30"))

# GET /api/events (también público): cada día nuevo son 2 consultas al HEK. El panel pide ±6 h alrededor de un
# instante de su línea de tiempo (180 días como mucho), así que se aceptan ventanas de hasta EVENTS_MAX_WINDOW_HOURS
# entre (ahora − EVENTS_MAX_AGE_DAYS) y mañana.
EVENTS_MAX_WINDOW_HOURS = float(os.environ.get("LASCO_EVENTS_MAX_WINDOW_HOURS", "48"))
EVENTS_MAX_AGE_DAYS = float(os.environ.get("LASCO_EVENTS_MAX_AGE_DAYS", "185"))

# GET /api/positions (pública): posiciones de SOHO y la Tierra pedidas a JPL Horizons y guardadas en SQLite. El
# cliente solo elige cuántos días y el paso; el fin lo pone el backend (fin de las efemérides de SOHO redondeado al
# paso), así que la caché sirve a todos y nadie puede pedir a JPL fechas o pasos cualquiera.
#   - stepMinutes: uno de POSITIONS_STEP_MINUTES (15 para la pestaña 24h, 360 para 30/90/180d);
#   - days entero entre 1 y POSITIONS_MAX_DAYS (el rango más largo del panel; también fija su retención);
#   - como mucho POSITIONS_MAX_SAMPLES instantes (180d cada 6 h son 721).
POSITIONS_STEP_MINUTES = (15, 360)
POSITIONS_MAX_DAYS = int(os.environ.get("LASCO_POSITIONS_MAX_DAYS", "180"))
POSITIONS_MAX_SAMPLES = int(os.environ.get("LASCO_POSITIONS_MAX_SAMPLES", "800"))
# El fin de las efemérides de SOHO se vuelve a consultar a JPL como mucho cada estos minutos (lo usan la ruta de
# posiciones y las sincronizaciones que terminan en "ephemeris").
EPHEMERIS_CHECK_MINUTES = float(os.environ.get("LASCO_EPHEMERIS_CHECK_MINUTES", "60"))

# Objetivos de Horizons: SOHO (la nave que lleva LASCO) y la Tierra.
SOHO_ID = "-21"
EARTH_ID = "399"

CONCURRENCY = int(os.environ.get("LASCO_CONCURRENCY", "6"))
REQUEST_TIMEOUT = float(os.environ.get("LASCO_REQUEST_TIMEOUT", "25"))
MAX_ATTEMPTS = 3

HELIOVIEWER_API = "https://api.helioviewer.org/v2"
HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
