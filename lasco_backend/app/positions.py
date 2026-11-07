"""Posiciones de SOHO y la Tierra para la línea de tiempo del panel, con caché en SQLite (tabla `positions`).

El fin de la ventana lo decide el backend: el último instante con efemérides de SOHO (o ahora) redondeado hacia
abajo a un múltiplo del paso desde 1970-01-01 UTC (6 h → 00/06/12/18 UTC; 15 min → :00/:15/:30/:45). Así todas las
ventanas son parte de una sola malla, la caché se reutiliza entre rangos y visitantes, y a JPL solo se le piden los
instantes nuevos.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

from . import horizons
from .config import EARTH_ID, SOHO_ID
from .store import Store, from_ms, to_ms

log = logging.getLogger("lasco.positions")

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

TARGETS = (SOHO_ID, EARTH_ID)  # SOHO primero: si el fin en caché quedó viejo, falla antes de pedir la Tierra

# Serializa el relleno de la caché: varias peticiones a la vez con la caché vacía hacen una sola consulta a JPL por
# objetivo (la siguiente encuentra la caché llena), y nunca hay consultas en paralelo hacia JPL (responde 503).
_fill_lock = asyncio.Lock()
# Tras un fallo del relleno no se vuelve a consultar a JPL hasta este time.monotonic() (horizons.RETRY_AFTER_FAILURE):
# mientras tanto se sirve lo que haya guardado. Así las peticiones en cola detrás de un relleno fallido terminan al
# instante y nadie puede hacer que el servidor insista contra JPL mientras falla.
_fill_retry_at = 0.0


def floor_to_step(value: datetime, minutes: int) -> datetime:
    """`value` redondeada hacia abajo a un múltiplo de `minutes` contado desde 1970-01-01 00:00 UTC."""
    step = timedelta(minutes=minutes)
    return value - (value - _EPOCH) % step


def _iso(ms: int) -> str:
    return from_ms(ms).isoformat().replace("+00:00", "Z")


def _missing(store: Store, target: str, start_ms: int, end_ms: int, step_ms: int) -> list[int]:
    cached = store.get_positions(target, start_ms, end_ms, step_ms)
    return [t for t in range(start_ms, end_ms + 1, step_ms) if t not in cached]


def _backing_off() -> bool:
    return time.monotonic() < _fill_retry_at


async def _fill(store: Store, client: httpx.AsyncClient, start_ms: int, end_ms: int, step_min: int) -> None:
    """Pide a JPL lo que falte en la caché, una consulta por objetivo, de a una. No consulta si JPL falló hace poco."""
    step_ms = step_min * 60_000
    # Camino rápido, sin el lock: con todo en caché no se hace cola detrás de un relleno lento.
    if not any(_missing(store, target, start_ms, end_ms, step_ms) for target in TARGETS):
        return
    async with _fill_lock:
        for target in TARGETS:
            if _backing_off():  # también si falló quien tenía el lock mientras esta petición esperaba
                return
            missing = _missing(store, target, start_ms, end_ms, step_ms)
            if not missing:
                continue
            rows = await horizons.fetch_vectors(client, target, from_ms(missing[0]), from_ms(missing[-1]), step_min)
            store.save_positions(target, rows)
            log.info(
                "JPL Horizons %s: %s → %s cada %d min, %d filas (faltaban %d)",
                target, _iso(missing[0]), _iso(missing[-1]), step_min, len(rows), len(missing),
            )


async def positions_window(store: Store, client: httpx.AsyncClient, days: int, step_minutes: int) -> dict:
    """Posiciones de los últimos `days` días cada `step_minutes`, terminando en el fin de las efemérides de SOHO.

    Si JPL falla (o falló hace menos de horizons.RETRY_AFTER_FAILURE s) se devuelve lo guardado desde el inicio de la
    ventana hasta el primer instante que falte, y `end` es el último instante devuelto. Lanza horizons.HorizonsError
    si no hay nada guardado para ese inicio (la ruta responde 502).
    """
    global _fill_retry_at
    step_ms = step_minutes * 60_000
    jpl_ok = True
    for attempt in (1, 2):
        now = datetime.now(timezone.utc)
        try:
            ephemeris_end = await horizons.soho_ephemeris_end(client)
        except (httpx.HTTPError, horizons.HorizonsError) as exc:
            # Sin fin conocido y JPL acaba de fallar: no se le piden vectores; se sirve lo guardado hasta ahora.
            log.warning("Posiciones sin el fin de las efemérides (%r): solo lo guardado", exc)
            ephemeris_end, jpl_ok = None, False
        end = floor_to_step(min(now, ephemeris_end or now), step_minutes)
        start_ms, end_ms = to_ms(end - timedelta(days=days)), to_ms(end)
        if not jpl_ok:
            break
        try:
            await _fill(store, client, start_ms, end_ms, step_minutes)
            break
        except horizons.EphemerisLimitError as exc:
            if attempt == 1:
                # Las efemérides terminan antes de lo que decía la caché: se corrige el fin y se reintenta una vez.
                log.info("SOHO sin efemérides después de %s; se recalcula la ventana", exc.limit.isoformat())
                horizons.note_ephemeris_limit(exc.limit)
                continue
            failure = exc
        except (httpx.HTTPError, horizons.HorizonsError) as exc:
            failure = exc
        _fill_retry_at = time.monotonic() + horizons.RETRY_AFTER_FAILURE
        log.warning(
            "Falló la consulta de posiciones a JPL (%r): no se vuelve a consultar en %d s",
            failure, horizons.RETRY_AFTER_FAILURE,
        )
        jpl_ok = False
        break

    soho = store.get_positions(SOHO_ID, start_ms, end_ms, step_ms)
    earth = store.get_positions(EARTH_ID, start_ms, end_ms, step_ms)
    # Si a JPL no se le pudo pedir lo que faltaba, solo el tramo guardado sin huecos desde el inicio de la ventana.
    complete = jpl_ok and not _backing_off()
    times = []
    for t in range(start_ms, end_ms + 1, step_ms):
        if t in soho and t in earth:
            times.append(t)
        elif not complete:
            break
    if not complete:
        if not times:
            raise horizons.HorizonsError("JPL no responde y no hay posiciones guardadas para el inicio de la ventana")
        if times[-1] != end_ms:
            log.warning(
                "Posiciones: JPL no disponible; se sirven %d de %d instantes (hasta %s)",
                len(times), (end_ms - start_ms) // step_ms + 1, _iso(times[-1]),
            )
        end_ms = times[-1]

    def vector(row: tuple) -> list[float]:
        # Posición a 0,001 km y velocidad a 1e-6 km/s: de sobra para el panel y la respuesta pesa la mitad.
        return [round(v, 3) for v in row[:3]] + [round(v, 6) for v in row[3:]]

    samples = [{"time": _iso(t), "soho": vector(soho[t]), "earth": vector(earth[t])} for t in times]
    return {"end": _iso(end_ms), "stepMinutes": step_minutes, "days": days, "samples": samples}
