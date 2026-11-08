"""Serialización a JSON compartida por la API (`main.py`) y la exportación estática (`export.py`).

No importa `main.py` ni crea un `Store`: el exportador la usa sin levantar la aplicación.
"""

from datetime import datetime, timezone

from .config import SIZES
from .store import from_ms


def iso(dt: datetime | None) -> str | None:
    """Fecha en ISO 8601 UTC con «Z» (None si no hay fecha)."""
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def image_json(row, url_prefix: str = "/api/files") -> dict:
    """Metadatos de una imagen, con los valores de cada tamaño guardado (radio y centro del Sol escalados).

    `url_prefix`: carpeta de las JPG en la url de cada tamaño (`/api/files` en la API; `images`, relativa, en la
    exportación estática).
    """
    files = {}
    for size in SIZES:
        k = size / row["width"]
        files[str(size)] = {
            "url": f"{url_prefix}/{row['instrument']}/{row['id']}_{size}.jpg",
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
        "time": iso(from_ms(row["time_ms"])),
        "files": files,
    }
