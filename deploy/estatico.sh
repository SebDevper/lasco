#!/usr/bin/env bash
# Construye la versión estática del panel en lasco_test/dist-static/: el front en modo estático más una «foto» de los
# datos (posiciones, imágenes LASCO C2/C3, encabezados FITS y eventos) en dist-static/data/. Sin backend ni
# «actualizar»: la foto cubre los rangos 24h y 30d y la consola muestra la fecha en que se hizo. Se publica tal cual en
# GitHub Pages u otro hosting estático. Se corre en cualquier carpeta del repositorio:
#   deploy/estatico.sh               # base relativa: sirve en la raíz o en una subcarpeta (usuario.github.io/repo/)
#   deploy/estatico.sh --base /repo/ # base fija
# La exportación usa la base del backend (lasco_backend/data, o LASCO_DATA_DIR): descarga lo que falte y aplica la
# retención, como cualquier sincronización. No correrlo mientras un servidor local sincroniza sobre la misma base.
set -euo pipefail

BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?--base necesita una ruta, p. ej. /repo/}"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; shift ;;
    -h | --help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "[error] opción desconocida: $1 (uso: deploy/estatico.sh [--base RUTA])" >&2; exit 1 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
EXPORT="$ROOT/lasco_backend/export"
SITE="$ROOT/lasco_test/dist-static"

if [ ! -x lasco_backend/.venv/bin/python ]; then
  echo "[error] falta el entorno del backend: cd lasco_backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi
if ! command -v npm >/dev/null; then
  echo "[error] no se encontró npm. Con nvm: export PATH=\"\$HOME/.nvm/versions/node/v26.13.0/bin:\$PATH\"" >&2
  exit 1
fi

echo "[1/3] Exportando la foto de los datos (sincroniza 24 h y 30 d, encabezados fits y eventos)"
code=0
(cd lasco_backend && .venv/bin/python -m app export --out "$EXPORT") || code=$?
case $code in
  0) ;;
  2) echo "[!] la exportación terminó con avisos (ver arriba): se sigue con la construcción" ;;
  *) echo "[error] falló la exportación (código $code): no se construye el sitio" >&2; exit 1 ;;
esac

echo "[2/3] Compilando el front en modo estático${BASE:+ (base $BASE)}"
if [ -n "$BASE" ]; then
  (cd lasco_test && npm run build:static -- --base "$BASE")
else
  (cd lasco_test && npm run build:static)
fi

echo "[3/3] Copiando la foto en dist-static/data"
rm -rf "$SITE/data"
cp -R "$EXPORT" "$SITE/data"
touch "$SITE/.nojekyll" # GitHub Pages: publicar tal cual, sin procesar con Jekyll

# Límites de GitHub Pages: sitio de hasta 1 GB, archivos de hasta 100 MB.
size_kb=$(du -sk "$SITE" | cut -f1)
echo "[ok] Sitio estático en lasco_test/dist-static ($(du -sh "$SITE" | awk '{print $1}'); se esperan ~30–40 MB)"
if [ "$size_kb" -gt 1048576 ]; then
  echo "[!] pasa de 1 GB: GitHub Pages no lo admite"
fi
big=$(find "$SITE" -type f -size +100M)
if [ -n "$big" ]; then
  echo "[!] archivos de más de 100 MB (GitHub no los admite):"
  echo "$big"
fi
echo "     probarlo en local: python3 -m http.server 4173 -d lasco_test/dist-static  →  http://localhost:4173/"
