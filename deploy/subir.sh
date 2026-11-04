#!/usr/bin/env bash
# Despliega en la VM la versión confirmada de una rama (por defecto main) y reconstruye los contenedores.
# Se corre desde el Mac, en cualquier carpeta del repositorio:
#   deploy/subir.sh ubuntu@203.0.113.10          # rama main
#   deploy/subir.sh ubuntu@203.0.113.10 develop  # otra rama o commit
# Sube solo lo confirmado en git (no los cambios sin commit, ni node_modules, .venv o data/). Las imágenes
# viven en el volumen de Docker de la VM, así que no se pierden al reemplazar el código.
set -euo pipefail

VM="${1:?Uso: deploy/subir.sh usuario@ip [rama]}"
REF="${2:-main}"
cd "$(git rev-parse --show-toplevel)"

echo "[1/2] Subiendo $REF ($(git rev-parse --short "$REF")) a $VM:~/lasco"
# ~/lasco/.env = los archivos de Compose de producción + ~/lasco.env: así, dentro de ~/lasco, un simple
# `docker compose …` (ps, logs, exec) ya usa docker-compose.prod.yml y la configuración.
git archive --format=tar "$REF" |
  ssh "$VM" 'rm -rf ~/lasco.new && mkdir ~/lasco.new && tar -x -C ~/lasco.new &&
    { echo "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml"; cat ~/lasco.env; } > ~/lasco.new/.env &&
    rm -rf ~/lasco && mv ~/lasco.new ~/lasco'

echo "[2/2] Reconstruyendo y levantando los contenedores"
ssh "$VM" 'cd ~/lasco && docker compose up -d --build --remove-orphans && docker image prune -f >/dev/null && docker compose ps'

echo "[ok] Desplegado. Progreso de las descargas: ssh $VM 'cd ~/lasco && docker compose logs -f backend'"
