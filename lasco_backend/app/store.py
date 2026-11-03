"""Índice SQLite de imágenes descargadas y de las ventanas de tiempo ya sincronizadas."""

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import DB_PATH, IMAGES_DIR, SIZES
from .helioviewer import ImageMeta

_SCHEMA = """
CREATE TABLE IF NOT EXISTS images (
    id          TEXT PRIMARY KEY,
    instrument  TEXT NOT NULL,
    time_ms     INTEGER NOT NULL,
    scale       REAL NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    rsun        REAL NOT NULL,
    center_x    REAL NOT NULL,
    center_y    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS images_by_time ON images (instrument, time_ms);

-- Ventanas sincronizadas. step_ms = 0: el backend tiene TODAS las imágenes publicadas en la ventana;
-- step_ms > 0: tiene la imagen más cercana a cada instante start, start + step, …
CREATE TABLE IF NOT EXISTS coverage (
    instrument  TEXT NOT NULL,
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER NOT NULL,
    step_ms     INTEGER NOT NULL DEFAULT 0
);

-- Sincronización muestreada: qué imagen corresponde a cada instante (evita volver a consultar Helioviewer).
CREATE TABLE IF NOT EXISTS samples (
    instrument  TEXT NOT NULL,
    time_ms     INTEGER NOT NULL,
    image_id    TEXT NOT NULL,
    PRIMARY KEY (instrument, time_ms)
);
"""


def to_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def from_ms(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def image_path(instrument: str, image_id: str, size: int) -> Path:
    return IMAGES_DIR / instrument / f"{image_id}_{size}.jpg"


class Store:
    def __init__(self, path: Path = DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(_SCHEMA)
            # Bases creadas antes de existir la sincronización muestreada.
            columns = {r["name"] for r in self._db.execute("PRAGMA table_info(coverage)")}
            if "step_ms" not in columns:
                self._db.execute("ALTER TABLE coverage ADD COLUMN step_ms INTEGER NOT NULL DEFAULT 0")
                self._db.commit()

    # ── Imágenes ────────────────────────────────────────────────────────────
    def has_files(self, instrument: str, image_id: str) -> bool:
        with self._lock:
            row = self._db.execute("SELECT 1 FROM images WHERE id = ?", (image_id,)).fetchone()
        return bool(row) and all(image_path(instrument, image_id, s).exists() for s in SIZES)

    def sample_image(self, instrument: str, when: datetime) -> str | None:
        """Imagen ya asignada a un instante de una sincronización muestreada (si sus archivos siguen en disco)."""
        with self._lock:
            row = self._db.execute(
                "SELECT image_id FROM samples WHERE instrument = ? AND time_ms = ?", (instrument, to_ms(when))
            ).fetchone()
        if row and self.has_files(instrument, row["image_id"]):
            return row["image_id"]
        return None

    def save_sample(self, instrument: str, when: datetime, image_id: str) -> None:
        with self._lock, self._db:
            self._db.execute("INSERT OR REPLACE INTO samples VALUES (?, ?, ?)", (instrument, to_ms(when), image_id))

    def has_image_at(self, instrument: str, when: datetime) -> bool:
        """¿Ya está guardada (con todos sus tamaños) la imagen tomada en `when` (±1 s)?"""
        ms = to_ms(when)
        with self._lock:
            row = self._db.execute(
                "SELECT id FROM images WHERE instrument = ? AND time_ms BETWEEN ? AND ?",
                (instrument, ms - 1000, ms + 1000),
            ).fetchone()
        return bool(row) and all(image_path(instrument, row["id"], s).exists() for s in SIZES)

    def save_image(self, meta: ImageMeta, files: dict[int, bytes]) -> None:
        for size, data in files.items():
            path = image_path(meta.instrument, meta.id, size)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)
        with self._lock, self._db:
            self._db.execute(
                "INSERT OR REPLACE INTO images VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    meta.id,
                    meta.instrument,
                    to_ms(meta.time),
                    meta.scale,
                    meta.width,
                    meta.height,
                    meta.rsun,
                    meta.center_x,
                    meta.center_y,
                ),
            )

    def list_images(self, start: datetime, end: datetime, instrument: str | None = None) -> list[sqlite3.Row]:
        sql = "SELECT * FROM images WHERE time_ms BETWEEN ? AND ?"
        args: list = [to_ms(start), to_ms(end)]
        if instrument:
            sql += " AND instrument = ?"
            args.append(instrument)
        with self._lock:
            return self._db.execute(sql + " ORDER BY instrument, time_ms", args).fetchall()

    def closest(self, instrument: str, when: datetime) -> sqlite3.Row | None:
        ms = to_ms(when)
        with self._lock:
            return self._db.execute(
                "SELECT * FROM images WHERE instrument = ? ORDER BY ABS(time_ms - ?) LIMIT 1", (instrument, ms)
            ).fetchone()

    def stats(self) -> dict:
        with self._lock:
            rows = self._db.execute(
                "SELECT instrument, COUNT(*) AS n, MIN(time_ms) AS first, MAX(time_ms) AS last FROM images GROUP BY instrument"
            ).fetchall()
        return {
            r["instrument"]: {"count": r["n"], "first": from_ms(r["first"]), "last": from_ms(r["last"])} for r in rows
        }

    # ── Cobertura ───────────────────────────────────────────────────────────
    def add_coverage(self, instrument: str, start: datetime, end: datetime, step_ms: int = 0) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO coverage (instrument, start_ms, end_ms, step_ms) VALUES (?, ?, ?, ?)",
                (instrument, to_ms(start), to_ms(end), step_ms),
            )

    def coverage(self) -> dict[str, list[tuple[datetime, datetime]]]:
        """Ventanas sincronizadas por instrumento, fusionadas cuando se solapan."""
        with self._lock:
            rows = self._db.execute("SELECT * FROM coverage ORDER BY instrument, start_ms").fetchall()
        merged: dict[str, list[list[int]]] = {}
        for r in rows:
            spans = merged.setdefault(r["instrument"], [])
            if spans and r["start_ms"] <= spans[-1][1]:
                spans[-1][1] = max(spans[-1][1], r["end_ms"])
            else:
                spans.append([r["start_ms"], r["end_ms"]])
        return {inst: [(from_ms(a), from_ms(b)) for a, b in spans] for inst, spans in merged.items()}
