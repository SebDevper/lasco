"""Último instante con posición de SOHO publicada en JPL Horizons."""

import re
from datetime import datetime, timedelta, timezone

import httpx

from .config import HORIZONS_API

_LIMIT = re.compile(r"No ephemeris for target .* after A\.D\. (\d{4}-[A-Z]{3}-\d{2} \d{2}:\d{2})")


async def soho_ephemeris_end(client: httpx.AsyncClient) -> datetime | None:
    """Pide a Horizons la posición de SOHO para ahora; si aún no está publicada, la respuesta indica hasta cuándo hay.

    Devuelve ese límite (menos 1 minuto, como hace el panel), o None si hay datos hasta ahora o no se pudo consultar.
    """
    now = datetime.now(timezone.utc)
    fmt = "%Y-%m-%d %H:%M"
    params = {
        "format": "json",
        "COMMAND": "'-21'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": "'500@10'",
        "START_TIME": f"'{(now - timedelta(hours=1)).strftime(fmt)}'",
        "STOP_TIME": f"'{now.strftime(fmt)}'",
        "STEP_SIZE": "'1 h'",
        "OBJ_DATA": "'NO'",
    }
    res = await client.get(HORIZONS_API, params=params)
    res.raise_for_status()
    match = _LIMIT.search(res.json().get("result", ""))
    if not match:
        return None
    limit = datetime.strptime(match.group(1).title(), "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
    return limit - timedelta(minutes=1)
