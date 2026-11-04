# Despliegue en Oracle Cloud (Always Free, sin pasar a Pay As You Go)

Esta guía deja el panel publicado con HTTPS en una VM gratuita de Oracle Cloud, con los mismos contenedores
de `docker-compose.yml` más un [Caddy](https://caddyserver.com) delante que gestiona el certificado.

```
navegador ──https──▶ caddy (80/443) ──▶ front (nginx) ──▶ backend (FastAPI) ──▶ volumen lasco_data
                                              └──▶ JPL Horizons            └──▶ Helioviewer, HEK
```

**Costo: 0.** La cuenta se queda en *Free Tier*: Oracle solo permite recursos "Always Free" y no tiene
cómo cobrar. La contrapartida es que puede **detener** una VM gratuita que pase 7 días casi sin uso; el
disco se conserva y basta con volver a encenderla (paso 9).

> Las condiciones de Oracle cambian: confirma los límites en la página "Always Free Resources" de su
> documentación antes de empezar.

Archivos de esta carpeta:

| Archivo | Dónde se corre | Qué hace |
|---|---|---|
| `instalar.sh` | en la VM, una vez | instala Docker, abre 80/443 en el firewall de la VM, crea `~/lasco.env` |
| `subir.sh` | en el Mac | sube la rama `main` (lo confirmado en git) a la VM y reconstruye los contenedores |
| `../docker-compose.prod.yml` | (Compose) | agrega Caddy (HTTPS automático) y deja de publicar el puerto 8080 del front |

---

## 1. Crear la cuenta

1. Regístrate en Oracle Cloud ("Start for free"). Piden tarjeta **solo para verificar la identidad**.
2. **Región de inicio**: elige una cercana y con capacidad ARM (no se puede cambiar después). Si dudas,
   las regiones grandes (p. ej. `US East (Ashburn)`, `Brazil East (Sao Paulo)`) suelen tener más.
3. Los primeros 30 días son de prueba con crédito. Al terminar, la cuenta pasa sola a *Free Tier*.
   **No pulses nunca "Upgrade to Pay As You Go"** (ni en los avisos que lo ofrecen).

## 2. Crear la VM

En la consola: **Compute → Instances → Create instance**.

| Campo | Valor |
|---|---|
| Name | `lasco` |
| Image | **Canonical Ubuntu 24.04** (la versión para ARM se elige sola con la forma) |
| Shape | **Ampere → `VM.Standard.A1.Flex`**, **1 OCPU y 6 GB** de memoria |
| Networking | crear una VCN nueva con **subred pública** y **asignar IPv4 pública** |
| SSH keys | "Upload public key files": tu `~/.ssh/id_ed25519.pub` (si no tienes: `ssh-keygen -t ed25519`) |
| Boot volume | el tamaño por defecto (~47 GB) |

- Comprueba que la forma y la imagen muestren la etiqueta **"Always Free-eligible"** antes de crear.
- 1 OCPU / 6 GB sobra para este proyecto y deja libre el resto de la cuota gratuita (4 OCPU / 24 GB).
- Si aparece **"Out of capacity"**: prueba otro *Availability Domain* en el mismo formulario o vuelve a
  intentar más tarde (a veces tarda días; es lo más habitual en cuentas gratuitas).

Cuando esté en *Running*, anota la **Public IP address** (en adelante `203.0.113.10` como ejemplo).

## 3. Abrir los puertos 80 y 443 en la red de Oracle

**Networking → Virtual cloud networks → (tu VCN) → Subnets → (subred pública) → Security Lists →
Default Security List → Add Ingress Rules**. Agrega dos reglas:

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(El puerto 22 de SSH ya viene abierto.) Además de esta lista, la VM tiene su propio firewall: lo abre
`instalar.sh` en el paso siguiente.

## 4. Preparar la VM

Desde el Mac, en la carpeta del proyecto:

```bash
scp deploy/instalar.sh ubuntu@203.0.113.10:
ssh ubuntu@203.0.113.10 'bash instalar.sh'
```

Instala Docker, abre los puertos en `iptables`, deja Docker arrancando con el sistema y crea `~/lasco.env`.

## 5. Elegir la dirección HTTPS

Caddy necesita un **nombre** (no una IP) para pedir el certificado. Dos opciones gratuitas:

- **sslip.io** (sin registrarse): `lasco.203-0-113-10.sslip.io` apunta a `203.0.113.10` (la IP con guiones).
- **DuckDNS** (cuenta gratuita): creas `algo.duckdns.org` y lo apuntas a la IP de la VM. Útil si quieres
  un nombre más corto o si Let's Encrypt rechaza sslip.io por exceso de certificados de otros usuarios
  (Caddy reintenta además con ZeroSSL).

Edita el archivo en la VM (si lo cambias más tarde, vuelve a correr `subir.sh` para aplicarlo):

```bash
ssh ubuntu@203.0.113.10 'nano ~/lasco.env'
```

```bash
SITE_ADDRESS=lasco.203-0-113-10.sslip.io
LASCO_RETENTION_DAYS=180
```

## 6. Primer despliegue

Desde el Mac (sube la rama `main`, que es la estable):

```bash
deploy/subir.sh ubuntu@203.0.113.10
```

La primera vez compila el front y el backend en la VM (unos minutos). Luego:

```bash
ssh ubuntu@203.0.113.10 'cd ~/lasco && docker compose logs -f backend caddy'
```

- `caddy`: debe aparecer `certificate obtained successfully`.
- `backend`: la sincronización inicial de 24 h (`Sincronización all … descargadas`).

Abre `https://lasco.203-0-113-10.sslip.io`.

## 7. Cargar las imágenes de los rangos largos

Al arrancar, el backend solo baja las últimas 24 h. Para el resto, en el panel elige **180d** y pulsa
**«actualizar»** una vez (~1.400 imágenes, algunos minutos). Como 30d, 90d y 180d usan los mismos
instantes cada 6 h, eso también cubre 30d y 90d.

**Alternativa: copiar las imágenes que ya tienes en el Mac** (después del paso 6):

```bash
ssh ubuntu@203.0.113.10 'cd ~/lasco && docker compose stop backend'
tar -C lasco_backend/data -cz . | ssh ubuntu@203.0.113.10 \
  'docker run --rm -i -v lasco_lasco_data:/data alpine sh -c "tar -C /data -xz && chown -R 1000:1000 /data"'
ssh ubuntu@203.0.113.10 'cd ~/lasco && docker compose start backend'
```

## 8. Publicar cambios

El flujo de siempre: trabajar en `develop`, pasar a `main` lo estable, y desplegar:

```bash
git checkout main && git merge --ff-only develop && git checkout develop
deploy/subir.sh ubuntu@203.0.113.10
```

`subir.sh` reemplaza `~/lasco` por el contenido de `main` (más `.env`, generado desde `~/lasco.env`) y reconstruye; las imágenes (volumen
`lasco_lasco_data`) y los certificados (volumen `lasco_caddy_data`) se conservan.

## 9. Mantenimiento

**Si Oracle detiene la VM por inactividad**: llega un correo de aviso. En **Compute → Instances → lasco**
pulsa **Start**. Docker arranca con el sistema y los contenedores (`restart: unless-stopped`) vuelven
solos, con las imágenes intactas. La IP pública se mantiene mientras no se *termine* la instancia.

Comandos útiles (en la VM, dentro de `~/lasco`; `subir.sh` deja en `~/lasco/.env` la configuración y
`COMPOSE_FILE`, así que `docker compose` ya incluye Caddy y `docker-compose.prod.yml`):

```bash
docker compose ps                    # estado de los contenedores
docker compose logs --tail 50 backend
docker compose exec backend python -m app sync --hours 48   # sincronizar a mano
df -h /                              # espacio en disco
docker system df                     # espacio de imágenes y volúmenes de Docker
```

Con la retención por defecto (180 días) el backend ocupa del orden de 150 MB; los 47 GB del disco de
arranque sobran.

## 10. Comprobar que sigue siendo gratis

- En la consola, arriba, la cuenta figura como **Free Tier** (no "Pay As You Go").
- **Billing & Cost Management → Cost Analysis**: todo en 0.
- Crea solo recursos con la etiqueta **"Always Free-eligible"**. Con la cuenta en Free Tier, Oracle no
  deja crear otros, pero durante los 30 días de prueba sí (se pagan con el crédito y se borran al acabar).

## Al compartir el enlace

El botón «actualizar» llama a `POST /api/sync`, abierto a cualquiera. El backend solo acepta las ventanas que pide
el panel y espera 30 s entre sincronizaciones (ver «Límites de la sincronización» en `lasco_backend/README.md`), así
que el disco y las descargas de Helioviewer quedan acotados aunque alguien lo use de forma abusiva.
