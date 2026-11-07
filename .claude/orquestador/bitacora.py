#!/usr/bin/env python3
"""Bitácora del orquestador de agentes: crea ejecuciones y registra lo que hace cada agente.

Uso (desde la raíz del repositorio):
  python3 .claude/orquestador/bitacora.py nueva "<título corto>"
  python3 .claude/orquestador/bitacora.py registrar <ejecución> <agente> <evento> "<mensaje>"
  python3 .claude/orquestador/bitacora.py cerrar <ejecución> <estado> ["<mensaje>"]
  python3 .claude/orquestador/bitacora.py ver [<ejecución>]
  python3 .claude/orquestador/bitacora.py lista
  python3 .claude/orquestador/bitacora.py entorno <ejecución> <nombre>   # foto de puertos y contenedores

<ejecución> es la carpeta que imprime `nueva` (ruta o solo el nombre). Las horas van en UTC, como el panel.
"""

import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
EJECUCIONES = BASE / "ejecuciones"
INDICE = EJECUCIONES / "INDICE.md"
REPO = BASE.parent.parent

AGENTES = {"orquestador", "planificador", "desarrollador", "revisor", "tester", "usuario"}
ESTADOS_FINALES = {"completada", "cancelada", "bloqueada"}

# Puertos que pueden usar las pruebas: Vite dev y preview, backend (8000 y el alternativo 8001), nginx de Docker.
PUERTOS_PRUEBAS = (5173, 4173, 8000, 8001, 8080)

CABECERA_INDICE ="# Ejecuciones del orquestador\n\n| inicio (UTC) | ejecución | título | estado |\n|---|---|---|---|\n"


def ahora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def slug(texto: str) -> str:
    ascii_ = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-")[:50] or "ejecucion"


def celda(texto: str) -> str:
    """Texto apto para una celda de tabla Markdown (una línea, sin barras verticales sueltas)."""
    return " ".join(texto.split()).replace("|", "\\|")


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "(no disponible)"


def resolver(ejecucion: str) -> Path:
    ruta = Path(ejecucion)
    candidatos = [ruta, REPO / ruta, EJECUCIONES / ruta.name]
    for c in candidatos:
        if (c / "bitacora.md").is_file():
            return c.resolve()
    sys.exit(f"[error] no existe la ejecución «{ejecucion}» (busqué en {EJECUCIONES})")


def rel(ruta: Path) -> str:
    return str(ruta.relative_to(REPO))


def nueva(titulo: str) -> None:
    EJECUCIONES.mkdir(parents=True, exist_ok=True)
    nombre = f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}-{slug(titulo)}"
    run = EJECUCIONES / nombre
    if run.exists():
        sys.exit(f"[error] ya existe {rel(run)}")
    for sub in ("desarrollo", "revisiones", "pruebas"):
        (run / sub).mkdir(parents=True)

    rama = git("rev-parse", "--abbrev-ref", "HEAD")
    base = git("rev-parse", "HEAD")
    estado_git = git("status", "--porcelain") or "(limpio)"
    (run / "solicitud.md").write_text(
        f"# {titulo}\n\n"
        f"- inicio: {ahora()}\n- rama: `{rama}`\n- commit base: `{base}`\n\n"
        f"## Estado de git al empezar\n\n```\n{estado_git}\n```\n\n"
        "## Solicitud del usuario\n\n<!-- el orquestador copia aquí la solicitud, textual -->\n\n"
        "## Aclaraciones\n\n<!-- preguntas al usuario y sus respuestas, con fecha -->\n",
        encoding="utf-8",
    )
    (run / "plan.md").write_text("# Plan\n\n<!-- lo escribe el planificador -->\n", encoding="utf-8")
    (run / "bitacora.md").write_text(
        f"# Bitácora · {titulo}\n\n"
        "estado: en curso\n\n"
        "| hora (UTC) | agente | evento | detalle |\n|---|---|---|---|\n",
        encoding="utf-8",
    )
    if not INDICE.exists():
        INDICE.write_text(CABECERA_INDICE, encoding="utf-8")
    with INDICE.open("a", encoding="utf-8") as f:
        f.write(f"| {ahora()} | [{nombre}]({nombre}/bitacora.md) | {celda(titulo)} | en curso |\n")
    registrar(run, "orquestador", "inicio", f"rama {rama}, base {base[:10]}")
    print(rel(run))


def registrar(run: Path, agente: str, evento: str, mensaje: str) -> None:
    if agente not in AGENTES:
        sys.exit(f"[error] agente desconocido «{agente}»; usa uno de: {', '.join(sorted(AGENTES))}")
    with (run / "bitacora.md").open("a", encoding="utf-8") as f:
        f.write(f"| {ahora()} | {agente} | {celda(evento)} | {celda(mensaje)} |\n")


def cerrar(run: Path, estado: str, mensaje: str) -> None:
    if estado not in ESTADOS_FINALES:
        sys.exit(f"[error] estado final desconocido «{estado}»; usa uno de: {', '.join(sorted(ESTADOS_FINALES))}")
    registrar(run, "orquestador", "fin", f"{estado}. {mensaje}".strip())
    bit = run / "bitacora.md"
    bit.write_text(bit.read_text(encoding="utf-8").replace("estado: en curso", f"estado: {estado}", 1), encoding="utf-8")
    if INDICE.exists():
        lineas = INDICE.read_text(encoding="utf-8").splitlines(keepends=True)
        marca = f"[{run.name}]("
        lineas = [l.replace("| en curso |", f"| {estado} |") if marca in l else l for l in lineas]
        INDICE.write_text("".join(lineas), encoding="utf-8")


def salida(cmd: list[str], vacio: str) -> str:
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as err:
        return f"(no disponible: {err})"
    if res.returncode != 0 and not res.stdout.strip():
        return vacio if not res.stderr.strip() else f"(no disponible: {res.stderr.strip()})"
    return res.stdout.strip() or vacio


def entorno(run: Path, nombre: str) -> None:
    """Guarda en RUN/pruebas/<nombre>.txt qué escucha en los puertos de prueba y qué contenedores corren."""
    lsof = ["lsof", "-nP", *(f"-iTCP:{p}" for p in PUERTOS_PRUEBAS), "-sTCP:LISTEN"]
    texto = (
        f"# entorno · {nombre} · {ahora()}\n\n"
        f"## Escuchando en {', '.join(map(str, PUERTOS_PRUEBAS))}\n\n"
        + salida(lsof, "(nada)")
        + "\n\n## Contenedores en marcha\n\n"
        + salida(["docker", "ps", "--format", "{{.ID}}  {{.Names}}  {{.Status}}"], "(ninguno)")
        + "\n"
    )
    destino = run / "pruebas" / f"{slug(nombre)}.txt"
    destino.write_text(texto, encoding="utf-8")
    print(texto, end="")
    print(f"\n[ok] guardado en {rel(destino)}")


def main(argv: list[str]) -> None:
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], argv[1:]
    if cmd == "nueva" and len(args) == 1:
        nueva(args[0])
    elif cmd == "registrar" and len(args) == 4:
        registrar(resolver(args[0]), *args[1:])
    elif cmd == "cerrar" and len(args) in (2, 3):
        cerrar(resolver(args[0]), args[1], args[2] if len(args) == 3 else "")
    elif cmd == "ver" and len(args) <= 1:
        if args:
            run = resolver(args[0])
        else:
            runs = sorted(p for p in EJECUCIONES.glob("*/bitacora.md"))
            if not runs:
                sys.exit("[!] todavía no hay ejecuciones")
            run = runs[-1].parent
        print((run / "bitacora.md").read_text(encoding="utf-8"), end="")
    elif cmd == "entorno" and len(args) == 2:
        entorno(resolver(args[0]), args[1])
    elif cmd == "lista" and not args:
        print(INDICE.read_text(encoding="utf-8") if INDICE.exists() else "[!] todavía no hay ejecuciones", end="")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
