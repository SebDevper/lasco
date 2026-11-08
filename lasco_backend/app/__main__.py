"""Línea de comandos:

    python -m app sync [--hours 24] [--until ephemeris|now|ISO]
    python -m app export [--out DIR]      foto estática de 24h y 30d (ver export.py)
"""

import argparse
import asyncio
import logging
from pathlib import Path

from .config import SYNC_HOURS, SYNC_UNTIL
from .export import DEFAULT_OUT, export
from .store import Store
from .sync import Syncer, default_window, new_client


async def _sync(hours: float, until: str) -> int:
    async with new_client() as client:
        start, end = await default_window(client, hours, until)
    state = await Syncer(Store()).run(start, end)
    print(
        f"{start:%Y-%m-%d %H:%M} → {end:%Y-%m-%d %H:%M} UTC: "
        f"{state.downloaded} descargadas, {state.skipped} ya estaban, {state.failed} fallidas, "
        f"{state.pruned} borradas por antigüedad"
    )
    return 1 if state.error or state.failed else 0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(prog="python -m app", description="Backend de imágenes LASCO")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sync", help="descarga las imágenes LASCO C2 y C3 de una ventana de tiempo")
    p.add_argument("--hours", type=float, default=SYNC_HOURS, help=f"horas hacia atrás (por defecto {SYNC_HOURS:g})")
    p.add_argument(
        "--until",
        default=SYNC_UNTIL,
        help='fin de la ventana: "ephemeris" (último dato de posición de SOHO), "now" o una fecha ISO',
    )
    p = sub.add_parser(
        "export",
        help="sincroniza 24 h y 30 d y exporta una foto estática de los datos para el front en modo estático",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"carpeta de salida (por defecto {DEFAULT_OUT}); se reemplaza solo si es una exportación anterior",
    )
    args = parser.parse_args()
    if args.cmd == "export":
        raise SystemExit(asyncio.run(export(args.out)))
    raise SystemExit(asyncio.run(_sync(args.hours, args.until)))


if __name__ == "__main__":
    main()
