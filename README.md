# Panel SOHO / LASCO

Panel web con estética de terminal que muestra el Sol en 3D, la posición real de la nave **SOHO** en su órbita halo
alrededor del punto de Lagrange L1, y las imágenes de su coronógrafo **LASCO** (C2 y C3) superpuestas tal como las
veía la nave.

- **Vista 3D** (three.js): el Sol, la Tierra, L1 y la trayectoria de SOHO. La vista «lasco» mira al Sol desde la nave
  con el norte solar arriba y superpone la imagen del coronógrafo alineada con el Sol 3D. Hay filtros de dibujo
  (ASCII y punteado).
- **Timelapse** de 24 horas (todas las imágenes, cada 15 min) o de 30, 90 y 180 días (una imagen cada 6 h).
- **En pausa**: encabezado FITS de cada imagen (exposición, filtro, campo, orientación de SOHO) y los eventos solares
  de ±6 h: eyecciones de masa coronal (CACTus), con su sector dibujado sobre la imagen, y fulguraciones (GOES).
- **Telemetría y gráficas**: distancia al Sol y a la Tierra, órbita halo vista desde la Tierra y tabla diaria.

## Cómo funciona

```
navegador ──▶ front (React + three.js) ──▶ /api/lasco ──▶ backend (FastAPI + SQLite)
                                                             ├──▶ JPL Horizons  (posiciones de SOHO y la Tierra)
                                                             ├──▶ Helioviewer   (imágenes LASCO, encabezados FITS)
                                                             └──▶ HEK (LMSAL)   (CME y fulguraciones)
```

| Carpeta | Qué es |
|---|---|
| [`lasco_test/`](lasco_test) | Front: Vite + React 18 + three.js, sin TypeScript. En contenedor lo sirve nginx. |
| [`lasco_backend/`](lasco_backend) | Backend en Python: sirve las posiciones de SOHO y la Tierra, descarga las imágenes LASCO, las guarda en disco y las sirve. Ver su [README](lasco_backend/README.md). |
| [`deploy/`](deploy) | Guía y scripts para publicarlo gratis en Oracle Cloud. Ver su [README](deploy/README.md). |

El navegador nunca habla con JPL, Helioviewer ni el HEK: el backend pide cada posición a JPL Horizons una sola vez
y la guarda, descarga las imágenes una vez (botón «actualizar») y luego sirve todo desde disco. Conserva 180 días;
lo más antiguo se borra solo. Sin el backend el panel no carga, salvo en la versión estática: una foto con fecha de
los rangos 24h y 30d que se publica sin servidor (ver «Publicarlo»).

## Correrlo en local

Requisitos: Node 26 (ver [`lasco_test/.nvmrc`](lasco_test/.nvmrc)) y Python 3.13.

```bash
# Backend (puerto 8000). Al arrancar descarga las imágenes de las últimas 24 h.
cd lasco_backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# Front (puerto 5173), en otra terminal
cd lasco_test
npm install
npm run dev
```

Abre http://localhost:5173. Para los rangos de 30, 90 y 180 días, elige el rango y pulsa «actualizar»: el backend
descarga una imagen por instante (~1.400 para 180 días, unos minutos).

## Con Docker

```bash
docker compose up -d --build     # http://localhost:8080
docker compose logs -f backend   # progreso de las descargas
docker compose down              # las imágenes quedan en el volumen lasco_data
```

## Publicarlo

[`deploy/README.md`](deploy/README.md) explica paso a paso cómo dejarlo en una VM gratuita de Oracle Cloud con HTTPS
(Caddy), sin pasar a una cuenta de pago. La API queda abierta, así que el backend y nginx limitan lo que se puede
pedir (ventanas de sincronización, fechas de eventos, peticiones por IP); los detalles están en las guías.

### Versión estática (sin servidor, p. ej. GitHub Pages)

Alternativa sin backend publicado: una «foto» de los datos (posiciones, imágenes C2/C3 en los dos tamaños,
encabezados FITS y eventos) de los rangos **24h y 30d**, que se actualiza volviendo a generarla. El panel abre en
24h, no tiene botón «actualizar» y la consola dice `[ok] datos actualizados al <fecha UTC> · versión estática`.
Ocupa ~30–40 MB.

```bash
# Con el entorno del backend instalado (ver «Correrlo en local»); no hace falta tenerlo corriendo
deploy/estatico.sh                 # exporta, compila y deja el sitio en lasco_test/dist-static/
python3 -m http.server 4173 -d lasco_test/dist-static   # probarlo en http://localhost:4173/
```

El script corre `python -m app export` (sincroniza las ventanas de 24 h y 30 d sobre la base local, pide los
encabezados que falten y escribe la foto en `lasco_backend/export/`), `npm run build:static` y copia la foto en
`dist-static/data/`. El sitio funciona en la raíz o en una subcarpeta (`usuario.github.io/repo/`); para fijar la
ruta, `deploy/estatico.sh --base /repo/`.

Para publicarlo en GitHub Pages (repositorio, Pages y el workflow manual `.github/workflows/pages.yml`), ver
[`deploy/github-pages.md`](deploy/github-pages.md).

## Configuración

Todo se configura con variables de entorno del backend (`LASCO_*`): ventana de sincronización, retención, límites
de la API y concurrencia de descargas. La lista completa está en
[`lasco_backend/README.md`](lasco_backend/README.md#variables-de-entorno).

## Datos y créditos

- Imágenes **SOHO/LASCO** (ESA y NASA), obtenidas a través de [Helioviewer.org](https://helioviewer.org).
- Posiciones de SOHO y la Tierra de [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) (NASA/JPL).
- Eventos solares del [Heliophysics Event Knowledgebase](https://www.lmsal.com/hek/) (LMSAL): eyecciones de masa
  coronal detectadas por [CACTus](https://www.sidc.be/cactus/) (SIDC) y fulguraciones de GOES (NOAA/SWPC).

SOHO es un proyecto de cooperación internacional entre la ESA y la NASA.
