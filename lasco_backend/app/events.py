"""Eventos solares de una ventana de tiempo, con caché por día UTC en SQLite."""

import asyncio
import logging
from datetime import date, datetime, time, timedelta, timezone

import httpx

from . import hek
from .store import Store

log = logging.getLogger("lasco.events")

# Los días recientes se vuelven a consultar: el HEK agrega y revisa eventos durante varios días.
RECENT_DAYS = 3
REFRESH_AFTER_MS = 3600 * 1000


async def _refresh_day(store: Store, client: httpx.AsyncClient, day: date, now_ms: int) -> None:
    key = day.isoformat()
    fetched = store.event_day_fetched(key)
    recent = (datetime.now(timezone.utc).date() - day).days <= RECENT_DAYS
    if fetched is not None and not (recent and now_ms - fetched > REFRESH_AFTER_MS):
        return
    start = datetime.combine(day, time(0, 0), tzinfo=timezone.utc)
    events = await hek.fetch_events(client, start, start + timedelta(days=1))
    store.save_events(key, events, now_ms)
    log.info("HEK %s: %d eventos", key, len(events))


async def events_between(store: Store, client: httpx.AsyncClient, start: datetime, end: datetime) -> dict:
    """Eventos que se solapan con [start, end]. Si el HEK falla, devuelve lo que haya en caché y el error."""
    # Un evento puede haber empezado el día anterior y seguir activo en la ventana.
    days = []
    d = (start - timedelta(days=1)).date()
    while d <= end.date():
        days.append(d)
        d += timedelta(days=1)
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    error = None
    results = await asyncio.gather(*(_refresh_day(store, client, d, now_ms) for d in days), return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            log.warning("No se pudo consultar el HEK: %s", r)
            error = str(r) or type(r).__name__
    return {"events": store.list_events(start, end), "error": error}
