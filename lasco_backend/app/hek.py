"""Eventos solares del Heliophysics Event Knowledgebase (HEK, LMSAL).

- CME (CE): eyecciones de masa coronal detectadas automáticamente en LASCO C2/C3 por CACTus: velocidad, ancho
  angular y ángulo de posición (AP, grados desde el norte solar hacia el este).
- Fulguraciones (FL): clase GOES, región activa y posición (catálogos SWPC/NOAA y SSW Latest Events).
"""

from datetime import datetime, timezone

import httpx

HEK_URL = "https://www.lmsal.com/hek/her"

# Catálogos de fulguraciones que se conservan (el resto de detectores repite los mismos eventos sin clase GOES).
FLARE_CATALOGS = ("SWPC", "SSW Latest Events")


def _hek_time(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


async def _search(client: httpx.AsyncClient, event_type: str, start: datetime, end: datetime) -> list[dict]:
    res = await client.get(
        HEK_URL,
        params={
            "cosec": 2,  # JSON
            "cmd": "search",
            "type": "column",
            "event_type": event_type,
            "event_starttime": _hek_time(start),
            "event_endtime": _hek_time(end),
            "event_coordsys": "helioprojective",
            # Caja enorme: incluir eventos fuera del disco (las CME están a varios radios solares).
            "x1": -30000,
            "x2": 30000,
            "y1": -30000,
            "y2": 30000,
            "result_limit": 500,
        },
    )
    res.raise_for_status()
    return res.json().get("result") or []


def _cme(x: dict) -> dict | None:
    if x.get("cme_radiallinvel") in (None, "") or x.get("event_coord1") in (None, ""):
        return None
    return {
        "id": x["kb_archivid"],
        "type": "cme",
        "catalog": x.get("frm_identifier") or x.get("frm_name"),
        "start": _parse(x.get("event_starttime")),
        "end": _parse(x.get("event_endtime")) or _parse(x.get("event_starttime")),
        "pa": float(x["event_coord1"]),
        "width": float(x.get("cme_angularwidth") or 0),
        "speed": float(x["cme_radiallinvel"]),
        "speedMin": x.get("cme_radiallinvelmin"),
        "speedMax": x.get("cme_radiallinvelmax"),
        "url": x.get("frm_url"),
    }


def _flare(x: dict) -> dict | None:
    if x.get("frm_name") not in FLARE_CATALOGS or not x.get("fl_goescls"):
        return None
    return {
        "id": x["kb_archivid"],
        "type": "flare",
        "catalog": x.get("frm_name"),
        "start": _parse(x.get("event_starttime")),
        "peak": _parse(x.get("event_peaktime")),
        "end": _parse(x.get("event_endtime")) or _parse(x.get("event_starttime")),
        "goesClass": x["fl_goescls"],
        "ar": x.get("ar_noaanum") or None,
        "hpcX": x.get("hpc_x"),
        "hpcY": x.get("hpc_y"),
        "observatory": x.get("obs_observatory"),
    }


def _dedupe_flares(flares: list[dict]) -> list[dict]:
    """El mismo evento aparece en varios catálogos (SWPC dice B4.7, SDO B4.8): picos a menos de 10 min → uno solo.

    Se conserva la clase y la región activa oficiales de SWPC (NOAA) y, si otro catálogo la tiene, la posición.
    """
    for f in flares:
        # SWPC (GOES) informa la clase pero no la posición en el disco: llega como 0 o vacía.
        if not f.get("hpcX") or f.get("observatory") == "GOES":
            f["hpcX"] = f["hpcY"] = None
    flares = sorted(flares, key=lambda f: (f["catalog"] != "SWPC", f["peak"] or f["start"]))
    kept: list[dict] = []
    for f in flares:
        t = f["peak"] or f["start"]
        twin = next((k for k in kept if abs(((k["peak"] or k["start"]) - t).total_seconds()) < 600), None)
        if twin is None:
            kept.append(f)
        elif twin["hpcX"] is None and f["hpcX"] is not None:
            twin["hpcX"], twin["hpcY"] = f["hpcX"], f["hpcY"]
    return kept


async def fetch_events(client: httpx.AsyncClient, start: datetime, end: datetime) -> list[dict]:
    """CME y fulguraciones que empiezan en [start, end]."""
    ces = await _search(client, "CE", start, end)
    fls = await _search(client, "FL", start, end)
    cmes = [e for e in map(_cme, ces) if e]
    flares = _dedupe_flares([e for e in map(_flare, fls) if e])
    return cmes + flares
