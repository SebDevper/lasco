"""API del backend LASCO.

  GET  /api/status                 estado de la sincronización, imágenes en disco y ventanas cubiertas
  GET  /api/images?start=&end=     imágenes guardadas en un rango (opcional: instrument=c2|c3)
  GET  /api/images/closest?instrument=&date=   imagen guardada más cercana a una fecha
  GET  /api/images/{id}/header    encabezado FITS resumido de una imagen (exposición, filtro, campo…)
  GET  /api/events?start=&end=     CME (CACTus) y fulguraciones (GOES) del HEK en una ventana (máx. 7 días)
  POST /api/sync                   sincroniza una ventana en segundo plano: {start, end, stepMinutes} o {hours, until}
                                   (hasta 48 h: todas las imágenes; más largas: una por instante de la línea de tiempo)
                                   y al terminar borra lo anterior a la retención (LASCO_RETENTION_DAYS)
  GET  /api/files/{c2|c3}/{id}_{512|1024}.jpg  archivos de imagen
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import xml.etree.ElementTree as ET

import httpx
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import helioviewer
from .config import IMAGES_DIR, INSTRUMENTS, RETENTION_DAYS, SIZES, SYNC_HOURS, SYNC_ON_START, SYNC_UNTIL
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


app = FastAPI(title="LASCO backend", lifespan=lifespan)
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
async def image_header(image_id: str = Path(..., pattern=r"^\d+$")):
    cached = store.get_header(image_id)
    if cached:
        return cached
    async with new_client() as client:
        try:
            header = await helioviewer.jp2_header(client, image_id)
        except (httpx.HTTPError, ET.ParseError) as exc:
            raise HTTPException(502, f"No se pudo obtener el encabezado de Helioviewer: {exc}") from exc
    store.save_header(image_id, header)
    return header


@app.get("/api/events")
async def events(start: str, end: str):
    a, b = _parse(start), _parse(end)
    if not timedelta(0) < b - a <= timedelta(days=7):
        raise HTTPException(422, "La ventana debe durar entre 0 y 7 días")
    async with new_client() as client:
        return await events_between(store, client, a, b)


class SyncRequest(BaseModel):
    hours: float | None = None
    until: str | None = None  # "ephemeris" | "now" | fecha ISO
    start: str | None = None
    end: str | None = None
    # Paso de la línea de tiempo del panel: en ventanas largas solo se baja la imagen más cercana a cada instante.
    stepMinutes: float | None = Field(None, gt=0)


@app.post("/api/sync", status_code=202)
async def sync(req: SyncRequest | None = None):
    if syncer.busy:
        raise HTTPException(409, "Ya hay una sincronización en curso")
    req = req or SyncRequest()
    if req.start and req.end:
        start, end = _parse(req.start), _parse(req.end)
    else:
        async with new_client() as client:
            start, end = await default_window(client, req.hours or SYNC_HOURS, req.until or SYNC_UNTIL)
    if end <= start:
        raise HTTPException(422, "La ventana está vacía")
    _start_sync(start, end, req.stepMinutes)
    return {
        "start": _iso(start),
        "end": _iso(end),
        "mode": choose_mode(start, end, req.stepMinutes),
        "instruments": list(INSTRUMENTS),
    }
