"""Exportación estática: una «foto» de los datos del panel para publicarla sin servidor (p. ej. GitHub Pages).

`python -m app export [--out DIR]` reutiliza lo mismo que usa la API y deja en DIR lo que el front en modo estático
(`npm run build:static`) lee en vez de `/api/lasco`:

    meta.json                 fecha de la foto, rangos, cobertura, conteos y avisos
    positions/1d-15m.json     mismo JSON que GET /api/positions?days=1&stepMinutes=15 (y 30d-360m.json)
    images.json               {images: {c2: [...], c3: [...]}} como GET /api/images, con urls relativas
    headers.json              {id: encabezado FITS resumido}
    events.json               {events: [...], error}: CME y fulguraciones del HEK de todo el período
    images/{c2,c3}/{id}_{512|1024}.jpg

Pasos: posiciones (positions_window), sincronización de las ventanas de 24 h y 30 d (Syncer.run, como el botón
«actualizar» de esas pestañas), selección de las imágenes que usa la foto, encabezados FITS que falten (se guardan en
la tabla `headers` y se reutilizan la próxima vez), eventos (events_between) y escritura en una carpeta temporal que
al final reemplaza a DIR.

Ojo: sincroniza y aplica la retención normal sobre la base (LASCO_DATA_DIR), como cualquier sincronización. No
correrlo a la vez que un servidor que esté sincronizando sobre la misma base.

Código de salida: 0 sin avisos, 2 con avisos (la foto se escribió igual), 1 error fatal (no se escribió nada).
"""

import asyncio
import json
import logging
import os
import shutil
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from . import helioviewer, horizons
from .config import BASE_DIR, CONCURRENCY, DATA_DIR, INSTRUMENTS, MAX_ATTEMPTS, SIZES
from .events import events_between
from .payloads import image_json, iso
from .positions import positions_window
from .store import Store, from_ms, image_path, to_ms
from .sync import Syncer, new_client

log = logging.getLogger("lasco.export")

# Rangos de la versión estática (días, paso en minutos): deben coincidir con los que muestra `Dashboard.jsx` en modo
# estático (`STATIC_RANGE_IDS`). El primero es la ventana con todas las imágenes; el último, la muestreada.
EXPORT_RANGES = ((1, 15), (30, 360))

GENERATOR = "lasco_backend export"
FORMAT = 1
DEFAULT_OUT = BASE_DIR / "export"

# Margen de los eventos alrededor de la foto: el panel pide ±6 h (EVENTS_WINDOW_H en lasco.js) alrededor del
# instante redondeado a la hora más cercana, así que cerca de los bordes la ventana llega hasta 6 h 30 min más allá.
EVENTS_MARGIN = timedelta(hours=7)
# Los eventos se piden por tramos: events_between lanza todos los días de la ventana a la vez.
EVENTS_CHUNK = timedelta(days=7)


class ExportError(Exception):
    """Error fatal: la foto no se escribe."""


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _positions_file(days: int, step: int) -> str:
    return f"positions/{days}d-{step}m.json"


def _is_ours(out: Path) -> bool:
    """¿`out` es una foto anterior (se puede reemplazar)? Una carpeta vacía también vale."""
    if not out.exists():
        return True
    if not out.is_dir():
        return False
    meta = out / "meta.json"
    if not meta.is_file():
        return not any(out.iterdir())
    try:
        return json.loads(meta.read_text()).get("generator") == GENERATOR
    except (OSError, ValueError, AttributeError):
        return False


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def _link(src: Path, dst: Path) -> None:
    """Enlace duro (no ocupa espacio) o, si el sistema no lo permite, copia."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


async def _header_with_retry(client: httpx.AsyncClient, image_id: str) -> dict:
    # sync._retry no reintenta ET.ParseError (Helioviewer a veces devuelve un XML cortado).
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return await helioviewer.jp2_header(client, image_id)
        except (httpx.HTTPError, ET.ParseError, ValueError):
            if attempt == MAX_ATTEMPTS:
                raise
            await asyncio.sleep(attempt)
    raise AssertionError("inalcanzable")


class Exporter:
    def __init__(self, out: Path):
        self.out = out.resolve()
        self.store = Store()
        self.warnings: list[str] = []
        self.stats = {"downloaded": 0, "skipped": 0, "headersRequested": 0, "headersReused": 0, "headersFailed": 0}

    def warn(self, message: str) -> None:
        log.warning(message)
        self.warnings.append(message)

    async def run(self) -> dict:
        if not _is_ours(self.out):
            raise ExportError(
                f"{self.out} existe y no es una exportación anterior"
                f" (no tiene el meta.json de «{GENERATOR}»): no se toca"
            )
        generated_at = datetime.now(timezone.utc).replace(microsecond=0)

        async with new_client() as client:
            positions = await self._positions(client)
            try:
                ephemeris_end = await horizons.soho_ephemeris_end(client)  # en caché: no vuelve a consultar
            except (httpx.HTTPError, horizons.HorizonsError):
                ephemeris_end = None
        windows = {
            key: (_parse(p["samples"][0]["time"]), _parse(p["samples"][-1]["time"])) for key, p in positions.items()
        }
        (d_all, s_all), (d_sampled, s_sampled) = EXPORT_RANGES[0], EXPORT_RANGES[-1]
        all_start, all_end = windows[(d_all, s_all)]
        smp_start, smp_end = windows[(d_sampled, s_sampled)]
        photo_end = max(all_end, smp_end)

        await self._sync(all_start, all_end, None, f"{d_all}d")
        await self._sync(smp_start, smp_end, s_sampled, f"{d_sampled}d")

        rows = self._select(all_start, all_end, smp_start, smp_end, s_sampled)
        async with new_client() as client:
            headers = await self._headers(client, [r["id"] for r in rows])
            events = await self._events(client, smp_start - EVENTS_MARGIN, photo_end + EVENTS_MARGIN)
        coverage = self._coverage(smp_start, photo_end)

        images = {inst: [image_json(r, "images") for r in rows if r["instrument"] == inst] for inst in INSTRUMENTS}
        meta = {
            "format": FORMAT,
            "generator": GENERATOR,
            "generatedAt": iso(generated_at),
            "ephemerisEnd": iso(ephemeris_end) if ephemeris_end else positions[(d_all, s_all)]["end"],
            "ranges": [
                {
                    "days": days,
                    "stepMinutes": step,
                    "file": _positions_file(days, step),
                    "start": positions[(days, step)]["samples"][0]["time"],
                    "end": positions[(days, step)]["end"],
                    "samples": len(positions[(days, step)]["samples"]),
                }
                for days, step in EXPORT_RANGES
            ],
            "coverage": coverage,
            "counts": {
                "images": {inst: len(v) for inst, v in images.items()},
                "headers": len(headers),
                "events": len(events["events"]),
            },
            "warnings": self.warnings,
        }
        size = self._write(meta, positions, images, headers, events, rows)
        return {"meta": meta, "size": size, "stats": self.stats}

    # ── 1. Posiciones ────────────────────────────────────────────────────────
    async def _positions(self, client: httpx.AsyncClient) -> dict[tuple[int, int], dict]:
        result = {}
        for days, step in EXPORT_RANGES:
            try:
                data = await positions_window(self.store, client, days, step)
            except (httpx.HTTPError, horizons.HorizonsError, ValueError) as exc:
                raise ExportError(f"no se pudieron obtener las posiciones de {days}d cada {step} min: {exc!r}") from exc
            expected = days * 1440 // step + 1
            if len(data["samples"]) != expected:
                # JPL falló a mitad: el panel mostraría una línea de tiempo recortada sin avisar.
                raise ExportError(
                    f"posiciones incompletas para {days}d cada {step} min: {len(data['samples'])} de {expected}"
                    " instantes (¿JPL Horizons no responde?)"
                )
            result[(days, step)] = data
        return result

    # ── 2. Imágenes: lo mismo que «actualizar» en cada pestaña ───────────────
    async def _sync(self, start: datetime, end: datetime, step: int | None, label: str) -> None:
        state = await Syncer(self.store).run(start, end, step)
        self.stats["downloaded"] += state.downloaded
        self.stats["skipped"] += state.skipped
        if state.error:
            self.warn(f"sincronización {label}: {state.error}")
        if state.failed:
            self.warn(f"sincronización {label}: {state.failed} de {state.total} imágenes fallaron")

    # ── 3. Selección: solo lo que usa la foto ────────────────────────────────
    def _select(self, all_start, all_end, smp_start, smp_end, step_minutes: int) -> list:
        step_ms = step_minutes * 60_000
        ids: list[str] = []
        for inst in INSTRUMENTS:
            sampled = self.store.sample_images(inst, smp_start, smp_end, step_ms)
            grid = range(to_ms(smp_start), to_ms(smp_end) + 1, step_ms)
            missing = [t for t in grid if t not in sampled]
            if missing:
                first = from_ms(missing[0]).strftime("%Y-%m-%d %H:%M")
                self.warn(f"{inst}: {len(missing)} instantes de la malla de 30d sin imagen (el primero, {first} UTC)")
            ids += sampled.values()
            ids += [r["id"] for r in self.store.list_images(all_start, all_end, inst)]
        rows = []
        for r in self.store.images_by_ids(ids):
            if all(image_path(r["instrument"], r["id"], s).is_file() for s in SIZES):
                rows.append(r)
            else:
                self.warn(f"{r['instrument']} {r['id']}: faltan sus archivos en disco; no va en la foto")
        return rows

    # ── 4. Encabezados FITS: los guardados se reutilizan, solo se piden los que falten ──
    async def _headers(self, client: httpx.AsyncClient, ids: list[str]) -> dict[str, dict]:
        missing = self.store.missing_headers(ids)
        self.stats["headersReused"] = len(ids) - len(missing)
        self.stats["headersRequested"] = len(missing)
        if missing:
            log.info("Encabezados FITS: %d guardados, %d a pedir a Helioviewer", len(ids) - len(missing), len(missing))
        sem = asyncio.Semaphore(CONCURRENCY)
        failed: list[str] = []

        async def one(image_id: str) -> None:
            async with sem:
                try:
                    header = await _header_with_retry(client, image_id)
                except (httpx.HTTPError, ET.ParseError, ValueError) as exc:
                    log.warning("Encabezado de %s: %r", image_id, exc)
                    failed.append(image_id)
                    return
                self.store.save_header(image_id, header)

        await asyncio.gather(*(one(i) for i in missing))
        self.stats["headersFailed"] = len(failed)
        if failed:
            self.warn(f"{len(failed)} encabezados fits no se pudieron obtener (el panel dirá «no disponible»)")
        headers = {}
        for image_id in ids:
            header = self.store.get_header(image_id)
            if header is not None:
                headers[image_id] = header
        return headers

    # ── 5. Eventos del HEK, por tramos ───────────────────────────────────────
    async def _events(self, client: httpx.AsyncClient, start: datetime, end: datetime) -> dict:
        by_id: dict[str, dict] = {}
        error = None
        a = start
        while a < end:
            b = min(a + EVENTS_CHUNK, end)
            result = await events_between(self.store, client, a, b)
            for e in result["events"]:
                by_id[e["id"]] = e
            error = error or result["error"]
            a = b
        if error:
            self.warn(f"eventos: {error}; la foto puede no tener todos los eventos")
        events = sorted(by_id.values(), key=lambda e: (_parse(e["start"]), e["id"]))
        return {"events": events, "error": error}

    # ── 6. Cobertura recortada al período de la foto ─────────────────────────
    def _coverage(self, start: datetime, end: datetime) -> dict[str, list[list[str]]]:
        result = {}
        for inst, spans in self.store.coverage().items():
            clipped = [(max(a, start), min(b, end)) for a, b in spans]
            result[inst] = [[iso(a), iso(b)] for a, b in clipped if a <= b]
        return result

    # ── 7. Escritura en una carpeta temporal que reemplaza a --out ──────────
    def _write(self, meta, positions, images, headers, events, rows) -> int:
        self.out.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.out.parent / f".{self.out.name}.tmp-{os.getpid()}"
        old = self.out.parent / f".{self.out.name}.old-{os.getpid()}"
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            tmp.mkdir()
            for (days, step), data in positions.items():
                _write_json(tmp / _positions_file(days, step), data)
            _write_json(tmp / "images.json", {"images": images})
            _write_json(tmp / "headers.json", headers)
            _write_json(tmp / "events.json", events)
            for r in rows:
                folder = tmp / "images" / r["instrument"]
                folder.mkdir(parents=True, exist_ok=True)
                for s in SIZES:
                    _link(image_path(r["instrument"], r["id"], s), folder / f"{r['id']}_{s}.jpg")
            # meta.json al final: una carpeta a medias no pasa por una exportación válida.
            _write_json(tmp / "meta.json", meta)
            size = sum(p.stat().st_size for p in tmp.rglob("*") if p.is_file())

            # Se vuelve a comprobar justo antes de reemplazar (alguien pudo crear la carpeta mientras tanto).
            if not _is_ours(self.out):
                raise ExportError(f"{self.out} cambió durante la exportación y ya no es una foto anterior: no se toca")
            if self.out.exists():
                self.out.rename(old)
            try:
                tmp.rename(self.out)
            except OSError:
                if old.exists():
                    old.rename(self.out)  # se deja la foto anterior como estaba
                raise
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        shutil.rmtree(old, ignore_errors=True)
        return size


def _fmt_size(n: int) -> str:
    return f"{n / 1e6:.1f} MB"


async def export(out: Path = DEFAULT_OUT) -> int:
    """Hace la exportación y muestra el resumen. Devuelve el código de salida (0, 2 con avisos, 1 fatal)."""
    log.info("Exportación estática hacia %s (base: %s)", out, DATA_DIR)
    try:
        result = await Exporter(out).run()
    except ExportError as exc:
        print(f"[error] exportación cancelada: {exc}")
        return 1
    except OSError as exc:  # disco lleno, sin permisos en la carpeta de --out…: la foto anterior queda igual
        log.debug("Error al escribir la foto", exc_info=True)
        print(f"[error] exportación cancelada: error de archivos: {exc}")
        return 1
    meta, stats = result["meta"], result["stats"]
    first, last = meta["ranges"][-1]["start"], meta["ranges"][0]["end"]
    images = meta["counts"]["images"]
    print(f"[ok] foto estática en {Path(out).resolve()} ({_fmt_size(result['size'])})")
    print(f"     generada: {meta['generatedAt']} · efemérides hasta {meta['ephemerisEnd']}")
    print(f"     período:  {first} → {last}")
    for r in meta["ranges"]:
        print(f"     {r['file']}: {r['samples']} instantes ({r['start']} → {r['end']})")
    print(
        f"     imágenes: c2 {images.get('c2', 0)}, c3 {images.get('c3', 0)} · "
        f"descargadas ahora {stats['downloaded']}, ya estaban {stats['skipped']}"
    )
    print(
        f"     encabezados fits: {meta['counts']['headers']} en la foto · pedidos {stats['headersRequested']}, "
        f"reutilizados {stats['headersReused']}, fallidos {stats['headersFailed']}"
    )
    print(f"     eventos: {meta['counts']['events']}")
    if meta["warnings"]:
        print(f"[!] {len(meta['warnings'])} avisos:")
        for w in meta["warnings"]:
            print(f"     - {w}")
        return 2
    return 0
