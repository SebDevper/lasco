"""Descarga de imágenes LASCO C2 y C3 de una ventana de tiempo.

Dos modos:
- "all": todas las imágenes publicadas en la ventana (ventanas de hasta ALL_IMAGES_MAX_HOURS).
- "sampled": la imagen más cercana a cada instante start, start + paso, … (ventanas más largas con paso).
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

from . import helioviewer, horizons
from .config import (
    ALL_IMAGES_MAX_HOURS,
    CONCURRENCY,
    INSTRUMENTS,
    MAX_ATTEMPTS,
    REQUEST_TIMEOUT,
    RETENTION_DAYS,
    RETENTION_MARGIN_DAYS,
    SIZES,
    SYNC_HOURS,
    SYNC_UNTIL,
)
from .helioviewer import ImageMeta
from .store import Store

log = logging.getLogger("lasco.sync")


@dataclass
class SyncState:
    running: bool = False
    mode: str | None = None  # "all" | "sampled"
    step_minutes: float | None = None
    start: datetime | None = None
    end: datetime | None = None
    total: int = 0
    done: int = 0
    downloaded: int = 0
    skipped: int = 0
    failed: int = 0
    pruned: int = 0  # imágenes borradas por la retención al terminar
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    failures: list[str] = field(default_factory=list)


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": "lasco-backend/0.1"},
        limits=httpx.Limits(max_connections=CONCURRENCY * 2),
    )


async def default_window(client: httpx.AsyncClient, hours: float = SYNC_HOURS, until: str = SYNC_UNTIL):
    """Las últimas `hours` horas, terminando ahora o en el último instante con posición de SOHO."""
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    end = now
    if until == "ephemeris":
        try:
            end = min(now, await horizons.soho_ephemeris_end(client) or now)
        except httpx.HTTPError as exc:
            log.warning("No se pudo consultar JPL Horizons (%s); la ventana termina ahora", exc)
    elif until != "now":
        end = datetime.fromisoformat(until.replace("Z", "+00:00"))
    return end - timedelta(hours=hours), end


def choose_mode(start: datetime, end: datetime, step_minutes: float | None) -> str:
    long_window = (end - start) > timedelta(hours=ALL_IMAGES_MAX_HOURS)
    return "sampled" if step_minutes and long_window else "all"


async def _retry(fn, *args):
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return await fn(*args)
        except (httpx.HTTPError, ValueError):
            if attempt == MAX_ATTEMPTS:
                raise
            await asyncio.sleep(attempt)


class Syncer:
    def __init__(self, store: Store):
        self.store = store
        self.state = SyncState()
        self._lock = asyncio.Lock()
        self._in_flight: dict[str, asyncio.Task] = {}

    @property
    def busy(self) -> bool:
        return self._lock.locked()

    async def run(self, start: datetime, end: datetime, step_minutes: float | None = None) -> SyncState:
        """Descarga lo que falte en [start, end]. Solo una sincronización a la vez."""
        if self._lock.locked():
            raise RuntimeError("Ya hay una sincronización en curso")
        async with self._lock:
            mode = choose_mode(start, end, step_minutes)
            # No descargar lo que la retención borraría al terminar. La malla de instantes muestreados se mantiene.
            cutoff = self._retention_cutoff(end)
            if cutoff and start < cutoff:
                step = timedelta(minutes=step_minutes) if mode == "sampled" else None
                start = cutoff if not step else start + -(-(cutoff - start) // step) * step
                log.info("Retención: la ventana empieza en %s (lo anterior no se conserva)", start.isoformat())
            self.state = SyncState(
                running=True,
                mode=mode,
                step_minutes=step_minutes if mode == "sampled" else None,
                start=start,
                end=end,
                started_at=datetime.now(timezone.utc),
            )
            try:
                try:
                    if start > end:
                        log.info("La ventana es anterior a la retención: no hay nada que descargar")
                    else:
                        await self._download(mode, start, end, step_minutes)
                except Exception as exc:  # noqa: BLE001 — se informa en /api/status
                    log.exception("Sincronización fallida")
                    self.state.error = str(exc)
                # Retención: aunque la descarga haya fallado, lo antiguo sigue sobrando.
                try:
                    await self._prune()
                except Exception as exc:  # noqa: BLE001
                    log.exception("Falló la limpieza de imágenes antiguas")
                    self.state.error = self.state.error or f"limpieza: {exc}"
            finally:
                self.state.running = False
                self.state.finished_at = datetime.now(timezone.utc)
                self._in_flight.clear()
            s = self.state
            log.info(
                "Sincronización %s %s → %s: %d descargadas, %d ya estaban, %d fallidas, %d borradas por antigüedad",
                mode, start.isoformat(), end.isoformat(), s.downloaded, s.skipped, s.failed, s.pruned,
            )
            return s

    async def _download(self, mode: str, start: datetime, end: datetime, step_minutes: float | None) -> None:
        async with new_client() as client:
            if mode == "sampled":
                await self._run_sampled(client, start, end, step_minutes)
            else:
                await self._run_all(client, start, end)

    def _retention_cutoff(self, end: datetime | None = None) -> datetime | None:
        """Lo anterior a este instante sobra: retención (+ margen) contada desde la ventana más reciente."""
        if RETENTION_DAYS <= 0:
            return None
        newest = max((t for t in (self.store.coverage_end(), end) if t is not None), default=None)
        return newest - timedelta(days=RETENTION_DAYS + RETENTION_MARGIN_DAYS) if newest else None

    async def _prune(self) -> None:
        """Borra lo que quedó fuera del rango más largo del panel, contado desde la ventana más reciente."""
        cutoff = self._retention_cutoff()
        if cutoff is None:
            return
        removed = await asyncio.to_thread(self.store.prune, cutoff)
        self.state.pruned = removed["images"]
        if any(removed.values()):
            log.info(
                "Retención (%g días, anterior a %s): %d imágenes, %d instantes, %d ventanas y %d eventos borrados",
                RETENTION_DAYS, cutoff.isoformat(), removed["images"], removed["samples"], removed["windows"],
                removed["events"],
            )

    # ── Descarga de una imagen (sin duplicar si dos instantes comparten imagen) ──
    async def _ensure(self, client: httpx.AsyncClient, meta: ImageMeta) -> bool:
        """Descarga la imagen si falta. Devuelve True si la descargó, False si ya estaba."""
        if self.store.has_files(meta.instrument, meta.id):
            return False
        task = self._in_flight.get(meta.id)
        if task is None:

            async def download():
                files = {size: await _retry(helioviewer.download_image, client, meta, size) for size in SIZES}
                self.store.save_image(meta, files)

            task = self._in_flight[meta.id] = asyncio.create_task(download())
            await task
            return True
        await task
        return False

    async def _gather_jobs(self, jobs, fetch) -> dict[str, int]:
        self.state.total = len(jobs)
        failed_by_inst = {inst: 0 for inst in INSTRUMENTS}
        sem = asyncio.Semaphore(CONCURRENCY)

        async def guarded(inst: str, *args) -> None:
            async with sem:
                try:
                    if await fetch(inst, *args):
                        self.state.downloaded += 1
                    else:
                        self.state.skipped += 1
                except Exception as exc:  # noqa: BLE001
                    self.state.failed += 1
                    failed_by_inst[inst] += 1
                    self.state.failures.append(f"{inst} {args[-1].isoformat()}: {exc}")
                    log.warning("Falló %s %s: %s", inst, args[-1].isoformat(), exc)
                finally:
                    self.state.done += 1

        await asyncio.gather(*(guarded(*job) for job in jobs))
        return failed_by_inst

    def _mark_coverage(self, jobs, failed: dict[str, int], start: datetime, end: datetime, step_ms: int) -> None:
        """Registra la ventana como sincronizada para cada coronógrafo, salvo que hayan fallado más del 10 %.

        Unos pocos fallos no invalidan la ventana: el panel usa la imagen vecina y la próxima sincronización
        reintenta solo lo que falta.
        """
        for inst, n_failed in failed.items():
            n_jobs = sum(1 for job in jobs if job[0] == inst)
            if n_jobs and n_failed <= 0.1 * n_jobs:
                self.store.add_coverage(inst, start, end, step_ms)
            else:
                log.warning("%s: %d de %d fallaron; la ventana no se marca como sincronizada", inst, n_failed, n_jobs)

    # ── Modo "all": todas las imágenes de la ventana ──
    async def _run_all(self, client: httpx.AsyncClient, start: datetime, end: datetime) -> None:
        jobs: list[tuple[str, int, datetime]] = []
        for inst, source_id in INSTRUMENTS.items():
            frames = await _retry(helioviewer.list_frames, client, source_id, start, end)
            log.info("%s: %d imágenes entre %s y %s", inst, len(frames), start.isoformat(), end.isoformat())
            jobs += [(inst, source_id, t) for t in frames]

        async def fetch(inst: str, source_id: int, when: datetime) -> bool:
            if self.store.has_image_at(inst, when):
                return False
            meta = await _retry(helioviewer.closest_image, client, inst, source_id, when)
            return await self._ensure(client, meta)

        failed = await self._gather_jobs(jobs, fetch)
        self._mark_coverage(jobs, failed, start, end, 0)

    # ── Modo "sampled": la imagen más cercana a cada instante ──
    async def _run_sampled(self, client: httpx.AsyncClient, start: datetime, end: datetime, step_minutes: float):
        step = timedelta(minutes=step_minutes)
        times = []
        t = start
        while t <= end:
            times.append(t)
            t += step
        log.info("Muestreo cada %g min: %d instantes por coronógrafo", step_minutes, len(times))
        jobs = [(inst, source_id, t) for inst, source_id in INSTRUMENTS.items() for t in times]

        async def fetch(inst: str, source_id: int, when: datetime) -> bool:
            if self.store.sample_image(inst, when):
                return False
            meta = await _retry(helioviewer.closest_image, client, inst, source_id, when)
            downloaded = await self._ensure(client, meta)
            self.store.save_sample(inst, when, meta.id)
            return downloaded

        failed = await self._gather_jobs(jobs, fetch)
        self._mark_coverage(jobs, failed, start, end, int(step.total_seconds() * 1000))
