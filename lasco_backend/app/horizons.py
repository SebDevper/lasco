"""Cliente de JPL Horizons: fin de las efemérides de SOHO (con caché en memoria) y vectores de posición."""

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone

import httpx

from .config import EPHEMERIS_CHECK_MINUTES, HORIZONS_API, SOHO_ID

log = logging.getLogger("lasco.horizons")

# Cada consulta a JPL: como mucho 20 s y 2 intentos (que el caso normal quede por debajo de los 60 s de nginx).
TIMEOUT = 20
ATTEMPTS = 2
# Tras un fallo de JPL no se le vuelve a consultar hasta dentro de estos segundos (ni el fin de las efemérides ni las
# posiciones que falten): con JPL caído o limitando la IP del servidor, cada petición esperaría los timeouts y
# alargaría el bloqueo. Mientras tanto se usa lo que haya guardado.
RETRY_AFTER_FAILURE = 300

JD_UNIX_EPOCH = 2440587.5

# Las efemérides de SOHO solo llegan hasta la última predicción publicada. Horizons responde, p. ej.:
# 'No ephemeris for target "SOHO (spacecraft)" after A.D. 2026-NOV-02 23:51:09.1825 TDB'
_LIMIT = re.compile(r"No ephemeris for target .* after A\.D\. (\d{4}-[A-Z]{3}-\d{2} \d{2}:\d{2})")


class HorizonsError(Exception):
    """Respuesta de Horizons sin los datos esperados (el detalle va al log, no al cliente)."""


class EphemerisLimitError(HorizonsError):
    """El rango pedido pasa del último instante con efemérides publicadas (`limit`)."""

    def __init__(self, limit: datetime):
        super().__init__(f"Sin efemérides después de {limit.isoformat()}")
        self.limit = limit


def _fmt(dt: datetime) -> str:
    # Horizons acepta 'YYYY-MM-DD HH:MM'. Se usa UTC (la diferencia con TDB, ~69 s, no importa aquí).
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")


def _parse_limit(text: str) -> datetime | None:
    match = _LIMIT.search(text)
    if not match:
        return None
    return datetime.strptime(match.group(1).title(), "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)


async def _query(client: httpx.AsyncClient, params: dict) -> dict:
    """GET a Horizons con timeout y reintento ante fallos de red o 5xx. Devuelve el JSON de la respuesta."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            res = await client.get(HORIZONS_API, params={"format": "json", **params}, timeout=TIMEOUT)
            if res.status_code < 500 or attempt == ATTEMPTS:
                res.raise_for_status()
                try:
                    return res.json()
                except ValueError as exc:
                    raise HorizonsError("Horizons no devolvió JSON") from exc
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            if attempt == ATTEMPTS or (isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500):
                raise
        await asyncio.sleep(attempt)
    raise AssertionError("inalcanzable")


# ── Fin de las efemérides de SOHO (caché en memoria) ─────────────────────────
_end_lock = asyncio.Lock()
_end_value: datetime | None = None  # None = hay datos hasta ahora
_end_known = False
_end_next_check = 0.0  # time.monotonic() a partir del cual se vuelve a consultar


async def _query_ephemeris_end(client: httpx.AsyncClient) -> datetime | None:
    now = datetime.now(timezone.utc)
    body = await _query(
        client,
        {
            "COMMAND": f"'{SOHO_ID}'",
            "EPHEM_TYPE": "'VECTORS'",
            "CENTER": "'500@10'",
            "START_TIME": f"'{_fmt(now - timedelta(hours=1))}'",
            "STOP_TIME": f"'{_fmt(now)}'",
            "STEP_SIZE": "'1 h'",
            "OBJ_DATA": "'NO'",
        },
    )
    limit = _parse_limit(body.get("result", ""))
    log.info("JPL Horizons: fin de las efemérides de SOHO %s", limit.isoformat() if limit else "posterior a ahora")
    return limit - timedelta(minutes=1) if limit else None


async def soho_ephemeris_end(client: httpx.AsyncClient) -> datetime | None:
    """Último instante con posición de SOHO publicada (límite de Horizons menos 1 minuto, como hacía el panel), o
    None si hay datos hasta ahora.

    Se consulta a JPL como mucho cada EPHEMERIS_CHECK_MINUTES. Si la consulta falla, no se vuelve a intentar hasta
    dentro de RETRY_AFTER_FAILURE segundos: mientras tanto se usa el último valor conocido o, si nunca hubo uno, se
    lanza el error (httpx.HTTPError o HorizonsError) sin consultar a JPL.
    """
    global _end_value, _end_known, _end_next_check
    async with _end_lock:
        if time.monotonic() < _end_next_check:
            if _end_known:
                return _end_value
            raise HorizonsError("JPL Horizons falló hace poco; todavía no se vuelve a consultar el fin")
        try:
            value = await _query_ephemeris_end(client)
        except (httpx.HTTPError, HorizonsError) as exc:
            _end_next_check = time.monotonic() + min(RETRY_AFTER_FAILURE, EPHEMERIS_CHECK_MINUTES * 60)
            if not _end_known:
                log.warning("No se pudo consultar el fin de las efemérides (%r) y no hay uno anterior", exc)
                raise
            log.warning("No se pudo consultar el fin de las efemérides (%r); se usa el anterior: %s", exc, _end_value)
            return _end_value
        _end_value, _end_known = value, True
        _end_next_check = time.monotonic() + EPHEMERIS_CHECK_MINUTES * 60
        return value


def note_ephemeris_limit(limit: datetime) -> None:
    """Una consulta de vectores dijo que no hay efemérides después de `limit`: el fin en caché quedó viejo."""
    global _end_value, _end_known, _end_next_check
    _end_value, _end_known = limit - timedelta(minutes=1), True
    _end_next_check = time.monotonic() + EPHEMERIS_CHECK_MINUTES * 60
    log.info("Fin de las efemérides de SOHO actualizado: %s", _end_value.isoformat())


# ── Vectores de posición ──────────────────────────────────────────────────────
async def fetch_vectors(
    client: httpx.AsyncClient, target: str, start: datetime, stop: datetime, step_minutes: int
) -> list[tuple]:
    """Posición y velocidad heliocéntricas (eclíptica J2000, km y km/s) de `target` cada `step_minutes` entre
    `start` y `stop` (incluidos). Devuelve filas (time_ms, x, y, z, vx, vy, vz) en orden temporal.

    Lanza EphemerisLimitError si el rango pasa del fin de las efemérides, HorizonsError si la respuesta no trae
    datos, o httpx.HTTPError si falla la conexión.
    """
    if stop <= start:
        # Horizons exige inicio < fin: para un solo instante se pide también el anterior (que ya existe).
        start = stop - timedelta(minutes=step_minutes)
    body = await _query(
        client,
        {
            "COMMAND": f"'{target}'",
            "EPHEM_TYPE": "'VECTORS'",
            "CENTER": "'500@10'",  # centro del Sol
            "REF_PLANE": "'ECLIPTIC'",
            "START_TIME": f"'{_fmt(start)}'",
            "STOP_TIME": f"'{_fmt(stop)}'",
            "STEP_SIZE": f"'{step_minutes} m'",
            "OUT_UNITS": "'KM-S'",
            "VEC_TABLE": "'2'",  # posición + velocidad
            "CSV_FORMAT": "'YES'",
            "OBJ_DATA": "'NO'",
        },
    )
    text = body.get("result", "")
    soe, eoe = text.find("$$SOE"), text.find("$$EOE")
    if soe == -1 or eoe == -1:
        limit = _parse_limit(text)
        if limit:
            raise EphemerisLimitError(limit)
        detail = body.get("error") or " ".join(text.strip().splitlines()[-3:])
        raise HorizonsError(f"Respuesta inesperada de Horizons para {target}: {detail[:300]}")

    rows = []
    try:
        for line in text[soe + 5 : eoe].strip().splitlines():
            # JDTDB, fecha, X, Y, Z, VX, VY, VZ,
            cols = [c.strip() for c in line.split(",")]
            jd = float(cols[0])
            # Al segundo: el JD en coma flotante deja errores de microsegundos (01:56:59.9998 en vez de 01:57:00).
            # Se toma TDB como UTC, igual que al pedir: así los instantes caen exactos en la malla.
            time_ms = round((jd - JD_UNIX_EPOCH) * 86_400) * 1000
            rows.append((time_ms, *(float(c) for c in cols[2:8])))
    except (ValueError, IndexError) as exc:
        raise HorizonsError(f"No se pudo leer la tabla de Horizons para {target}: {exc}") from exc
    return rows
