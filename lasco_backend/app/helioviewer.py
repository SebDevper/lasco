"""Cliente de la API de Helioviewer para imágenes LASCO."""

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from .config import HELIOVIEWER_API


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class ImageMeta:
    id: str
    instrument: str
    time: datetime
    scale: float  # segundos de arco por píxel a tamaño nativo
    width: int
    height: int
    rsun: float  # radio solar en píxeles (tamaño nativo)
    center_x: float  # centro del Sol en píxeles, origen arriba a la izquierda
    center_y: float


async def list_frames(client: httpx.AsyncClient, source_id: int, start: datetime, end: datetime) -> list[datetime]:
    """Instantes de todas las imágenes de una fuente en [start, end] (vía getJPX con verbose=true)."""
    res = await client.get(
        f"{HELIOVIEWER_API}/getJPX/",
        params={"startTime": iso(start), "endTime": iso(end), "sourceId": source_id, "verbose": "true", "jpip": "true"},
    )
    res.raise_for_status()
    frames = res.json().get("frames") or []
    return [datetime.fromtimestamp(f, tz=timezone.utc) for f in frames]


async def closest_image(client: httpx.AsyncClient, instrument: str, source_id: int, when: datetime) -> ImageMeta:
    res = await client.get(f"{HELIOVIEWER_API}/getClosestImage/", params={"date": iso(when), "sourceId": source_id})
    res.raise_for_status()
    m = res.json()
    if not m.get("id"):
        raise ValueError(m.get("error") or "Helioviewer no devolvió imagen")
    return ImageMeta(
        id=str(m["id"]),
        instrument=instrument,
        time=datetime.strptime(m["date"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc),
        scale=float(m["scale"]),
        width=int(m["width"]),
        height=int(m["height"]),
        rsun=float(m["rsun"]),
        # refPixel viene en coordenadas FITS (y hacia arriba).
        center_x=float(m["refPixelX"]),
        center_y=float(m["height"]) - float(m["refPixelY"]),
    )


def _num(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _int(value: str | None) -> int | None:
    n = _num(value)
    return int(n) if n is not None else None


async def jp2_header(client: httpx.AsyncClient, image_id: str) -> dict:
    """Encabezado FITS de una imagen (getJP2Header), reducido a los campos que muestra el panel."""
    res = await client.get(f"{HELIOVIEWER_API}/getJP2Header/", params={"id": image_id})
    res.raise_for_status()
    root = ET.fromstring(res.text)
    h = {el.tag: (el.text or "").strip() for el in root.iter() if len(el) == 0 and el.text}

    observed = None
    if h.get("DATE_OBS") and h.get("TIME_OBS"):
        observed = datetime.strptime(f"{h['DATE_OBS']} {h['TIME_OBS'][:8]}", "%Y/%m/%d %H:%M:%S").replace(
            tzinfo=timezone.utc
        )
    return {
        "observedAt": observed.isoformat().replace("+00:00", "Z") if observed else None,
        "detector": h.get("DETECTOR"),
        "exposure": _num(h.get("EXPTIME")),  # s, ya corregida
        "filter": h.get("FILTER"),
        "polarizer": h.get("POLAR"),
        # Rotación de la imagen original respecto del norte solar ≈ orientación de SOHO (±180° tras sus giros).
        "roll": _num(h.get("CROTA") or h.get("CROTA1")),
        "plateScale": _num(h.get("CDELT1") or h.get("PLATESCL")),  # segundos de arco por píxel (1024 px)
        "fieldInner": _num(h.get("HV_ROCC_INNER")),  # radios solares
        "fieldOuter": _num(h.get("HV_ROCC_OUTER")),
        "binning": f"{h.get('LEBXSUM', '1')}×{h.get('LEBYSUM', '1')}",
        "readPort": h.get("READPORT"),
        "compression": h.get("COMPRSSN"),
        "file": h.get("FILENAME"),
        "fileOrig": h.get("FILEORIG"),
        "quicklook": h.get("HV_QUICKLOOK", "").upper() == "TRUE",
        "missingBlocks": _int(h.get("NMISSING")),
        "saturated": _int(h.get("DATASAT")),
    }


async def download_image(client: httpx.AsyncClient, meta: ImageMeta, size: int) -> bytes:
    """JPG de la imagen reducida a `size` px de ancho (Helioviewer la entrega con el norte solar arriba)."""
    k = size / meta.width
    res = await client.get(
        f"{HELIOVIEWER_API}/downloadImage/",
        params={
            "id": meta.id,
            "scale": meta.scale / k,
            "type": "jpg",
            "width": size,
            "height": round(meta.height * k),
        },
    )
    res.raise_for_status()
    if not res.headers.get("content-type", "").startswith("image/"):
        raise ValueError(f"Respuesta inesperada de Helioviewer: {res.headers.get('content-type')}")
    return res.content
