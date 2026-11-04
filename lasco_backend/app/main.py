"""API del backend LASCO.

  GET  /api/status                 estado de la sincronización, imágenes en disco y ventanas cubiertas
  GET  /api/images?start=&end=     imágenes guardadas en un rango (opcional: instrument=c2|c3)
  GET  /api/images/closest?instrument=&date=   imagen guardada más cercana a una fecha
  GET  /api/images/{id}/header    encabezado FITS resumido de una imagen (exposición, filtro, campo…)
  GET  /api/events?start=&end=     CME (CACTus) y fulguraciones (GOES) del HEK en una ventana (máx. 48 h, últimos 185 días)
  POST /api/sync                   sincroniza una ventana en segundo plano: {start, end, stepMinutes} o {hours, until}
                                   (hasta 48 h: todas las imágenes; más largas: una por instante de la línea de tiempo)
                                   y al terminar borra lo anterior a la retención (LASCO_RETENTION_DAYS).
                                   Pública: solo acepta las ventanas que pide el panel (límites en config.py);
                                   422 si no, 409 si hay otra en curso, 429 si la anterior acaba de terminar
  GET  /api/files/{c2|c3}/{id}_{512|1024}.jpg  archivos de imagen
"""

import asyncio
import logging
import math
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import xml.etree.ElementTree as ET

import httpx
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import helioviewer
from .config import (
    ALL_IMAGES_MAX_HOURS,
    EVENTS_MAX_AGE_DAYS,
    EVENTS_MAX_WINDOW_HOURS,
    IMAGES_DIR,
    INSTRUMENTS,
    RETENTION_DAYS,
    SIZES,
    SYNC_ALL_RECENT_HOURS,
    SYNC_COOLDOWN_SECONDS,
    SYNC_HOURS,
    SYNC_MAX_SAMPLES,
    SYNC_MIN_STEP_MINUTES,
    SYNC_ON_START,
    SYNC_UNTIL,
)
from .events import events_between
from .store import Store, from_ms
from .sync import Syncer, choose_mode, default_window, new_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("lasco.api")

store = Store()
syncer = Syncer(store)
_background: set[asyncio.Task] = set()


def _start_sync(start: datetime, end: datetime, step_minutes: float | None = None) -> None:
    task = asyncio.create_task(syncer.run(start, end, step_minutes))
    _background.add(task)
    task.add_done_callback(_background.discard)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    if SYNC_ON_START:
        async with new_client() as client:
            start, end = await default_window(client)
        log.info("Sincronización inicial: %s → %s", start.isoformat(), end.isoformat())
        _start_sync(start, end)
    yield


# Sin /docs, /redoc ni /openapi.json: la API queda expuesta en internet y no hace falta publicar su descripción.
app = FastAPI(title="LASCO backend", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/files", StaticFiles(directory=IMAGES_DIR), name="files")


def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def _parse(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(422, f"Fecha inválida: {value}") from exc
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _image_json(row) -> dict:
    """Metadatos de una imagen, con los valores de cada tamaño guardado (radio y centro del Sol escalados)."""
    files = {}
    for size in SIZES:
        k = size / row["width"]
        files[str(size)] = {
            "url": f"/api/files/{row['instrument']}/{row['id']}_{size}.jpg",
            "width": size,
            "height": round(row["height"] * k),
            "scale": row["scale"] / k,
            "rsunPx": row["rsun"] * k,
            "centerX": row["center_x"] * k,
            "centerY": row["center_y"] * k,
        }
    return {
        "id": row["id"],
        "instrument": row["instrument"],
        "time": _iso(from_ms(row["time_ms"])),
        "files": files,
    }


@app.get("/api/status")
def status():
    s = syncer.state
    return {
        "sync": {
            "running": s.running,
            "mode": s.mode,
            "stepMinutes": s.step_minutes,
            "start": _iso(s.start),
            "end": _iso(s.end),
            "total": s.total,
            "done": s.done,
            "downloaded": s.downloaded,
            "skipped": s.skipped,
            "failed": s.failed,
            "pruned": s.pruned,
            "error": s.error,
            "startedAt": _iso(s.started_at),
            "finishedAt": _iso(s.finished_at),
        },
        "images": {
            inst: {"count": v["count"], "first": _iso(v["first"]), "last": _iso(v["last"])}
            for inst, v in store.stats().items()
        },
        "coverage": {inst: [[_iso(a), _iso(b)] for a, b in spans] for inst, spans in store.coverage().items()},
        "config": {"syncHours": SYNC_HOURS, "syncUntil": SYNC_UNTIL, "retentionDays": RETENTION_DAYS},
    }


@app.get("/api/images")
def list_images(start: str, end: str, instrument: str | None = Query(None, pattern="^(c2|c3)$")):
    rows = store.list_images(_parse(start), _parse(end), instrument)
    return {"images": [_image_json(r) for r in rows]}


@app.get("/api/images/closest")
def closest_image(instrument: str = Query(..., pattern="^(c2|c3)$"), date: str = Query(...)):
    row = store.closest(instrument, _parse(date))
    if not row:
        raise HTTPException(404, "No hay imágenes guardadas")
    return _image_json(row)


@app.get("/api/images/{image_id}/header")
async def image_header(image_id: str = Path(..., pattern=r"^\d{1,12}$")):
    cached = store.get_header(image_id)
    if cached:
        return cached
    # Solo imágenes que tiene el backend: si no, cualquiera podría hacerle consultar (y guardar para siempre) el
    # encabezado de cualquier imagen de Helioviewer.
    if not store.has_image(image_id):
        raise HTTPException(404, "El backend no tiene esa imagen")
    async with new_client() as client:
        try:
            header = await helioviewer.jp2_header(client, image_id)
        except (httpx.HTTPError, ET.ParseError, ValueError) as exc:
            log.warning("Encabezado de %s: %s", image_id, exc)
            raise HTTPException(502, "No se pudo obtener el encabezado de Helioviewer") from exc
    store.save_header(image_id, header)
    return header


@app.get("/api/events")
async def events(start: str, end: str):
    a, b = _parse(start), _parse(end)
    if not timedelta(0) < b - a <= timedelta(hours=EVENTS_MAX_WINDOW_HOURS):
        raise HTTPException(422, f"La ventana debe durar entre 0 y {EVENTS_MAX_WINDOW_HOURS:g} h")
    # Solo el período que puede mostrar el panel: cada día nuevo son consultas al HEK que quedan guardadas.
    now = datetime.now(timezone.utc)
    if a < now - timedelta(days=EVENTS_MAX_AGE_DAYS) or b > now + timedelta(days=1):
        raise HTTPException(422, f"Solo hay eventos de los últimos {EVENTS_MAX_AGE_DAYS:g} días")
    async with new_client() as client:
        return await events_between(store, client, a, b)


class SyncRequest(BaseModel):
    hours: float | None = Field(None, gt=0, allow_inf_nan=False)
    until: str | None = None  # "ephemeris" | "now" | fecha ISO
    start: str | None = None
    end: str | None = None
    # Paso de la línea de tiempo del panel: en ventanas largas solo se baja la imagen más cercana a cada instante.
    stepMinutes: float | None = Field(None, gt=0, allow_inf_nan=False)


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _snap_to_grid(value: datetime, step: timedelta) -> datetime:
    """`value` en la malla de múltiplos de `step` desde 1970-01-01 UTC (tolera 2 s de redondeo), o 422."""
    offset = (value - _EPOCH) % step
    if offset <= timedelta(seconds=2):
        return value - offset
    if step - offset <= timedelta(seconds=2):
        return value - offset + step
    raise HTTPException(
        422, f"En ventanas largas, start y end deben caer en múltiplos de {step / timedelta(minutes=1):g} min (UTC)"
    )


def _check_window(start: datetime, end: datetime, step_minutes: float | None) -> tuple[datetime, datetime]:
    """Rechaza (422) las ventanas que el panel no pide: la API es pública y cada sincronización descarga de
    Helioviewer y escribe en disco. Ver los límites en config.py. Devuelve la ventana a sincronizar.

    En las muestreadas solo vale la malla fija de múltiplos de SYNC_MIN_STEP_MINUTES (00/06/12/18 UTC): si se
    pudiera correr la malla (o elegir un paso cualquiera), cada petición descargaría ~1.400 imágenes nuevas.
    """
    now = datetime.now(timezone.utc)
    if end <= start:
        raise HTTPException(422, "La ventana está vacía")
    # Una ventana en el futuro correría el corte de la retención y borraría las imágenes reales.
    if end > now + timedelta(minutes=10):
        raise HTTPException(422, "La ventana no puede terminar en el futuro")
    if choose_mode(start, end, step_minutes) == "all":
        if end - start > timedelta(hours=ALL_IMAGES_MAX_HOURS):
            raise HTTPException(
                422, f"Las ventanas de más de {ALL_IMAGES_MAX_HOURS:g} h necesitan stepMinutes (una imagen por instante)"
            )
        if start < now - timedelta(hours=SYNC_ALL_RECENT_HOURS):
            raise HTTPException(
                422, f"Todas las imágenes solo se descargan para las últimas {SYNC_ALL_RECENT_HOURS:g} h"
            )
        return start, end
    if step_minutes % SYNC_MIN_STEP_MINUTES:
        raise HTTPException(422, f"En ventanas largas stepMinutes debe ser múltiplo de {SYNC_MIN_STEP_MINUTES:g}")
    step = timedelta(minutes=step_minutes)
    start, end = _snap_to_grid(start, step), _snap_to_grid(end, step)
    samples = (end - start) / step + 1
    if samples > SYNC_MAX_SAMPLES:
        raise HTTPException(422, f"La ventana tiene {samples:.0f} instantes; el máximo es {SYNC_MAX_SAMPLES}")
    return start, end


@app.post("/api/sync", status_code=202)
async def sync(req: SyncRequest | None = None):
    if syncer.busy:
        raise HTTPException(409, "Ya hay una sincronización en curso")
    finished = syncer.state.finished_at
    if finished:
        wait = SYNC_COOLDOWN_SECONDS - (datetime.now(timezone.utc) - finished).total_seconds()
        if wait > 0:
            seconds = math.ceil(wait)
            raise HTTPException(
                429, f"La última sincronización acaba de terminar; espera {seconds} s", {"Retry-After": str(seconds)}
            )
    req = req or SyncRequest()
    if req.start and req.end:
        start, end = _parse(req.start), _parse(req.end)
    else:
        until = req.until or SYNC_UNTIL
        if until not in ("ephemeris", "now"):
            until = _parse(until).isoformat()  # 422 si no es una fecha (antes daba 500)
        async with new_client() as client:
            start, end = await default_window(client, req.hours or SYNC_HOURS, until)
    start, end = _check_window(start, end, req.stepMinutes)
    _start_sync(start, end, req.stepMinutes)
    return {
        "start": _iso(start),
        "end": _iso(end),
        "mode": choose_mode(start, end, req.stepMinutes),
        "instruments": list(INSTRUMENTS),
    }
