#!/usr/bin/env bash
# Prepara una VM Ubuntu (22.04/24.04) de Oracle Cloud para el panel. Se corre UNA vez, en la VM:
#   bash instalar.sh
# Instala Docker (repositorio oficial), abre los puertos 80/443 en el firewall de la VM y deja Docker
# arrancando con el sistema (los contenedores tienen restart: unless-stopped, así que vuelven solos).
set -euo pipefail

echo "[1/3] Docker Engine + Compose"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "[2/3] Firewall de la VM: puertos 80 y 443"
# Las imágenes Ubuntu de Oracle traen reglas iptables que rechazan todo salvo SSH. La regla se inserta
# al principio (antes del REJECT) y se guarda para que sobreviva a los reinicios.
if ! sudo iptables -C INPUT -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT
fi
if ! command -v netfilter-persistent >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
fi
sudo netfilter-persistent save

echo "[3/3] Archivo de configuración ~/lasco.env"
if [ ! -f ~/lasco.env ]; then
  cat >~/lasco.env <<'EOF'
# Dirección pública del panel (ver deploy/README.md, paso 5). Ejemplo con sslip.io para la IP 203.0.113.10:
SITE_ADDRESS=lasco.203-0-113-10.sslip.io
# Días de imágenes que se conservan.
LASCO_RETENTION_DAYS=180
EOF
  echo "    creado: edita SITE_ADDRESS con:  nano ~/lasco.env"
else
  echo "    ya existe, no se toca"
fi

echo
echo "[ok] VM lista. Cierra la sesión SSH y vuelve a entrar para usar docker sin sudo."
