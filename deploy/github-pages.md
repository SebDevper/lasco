# Publicar la versión estática en GitHub Pages

Guía para publicar el panel **sin servidor**: una «foto» de los datos (rangos 24h y 30d: posiciones de SOHO y la
Tierra, imágenes LASCO C2/C3, encabezados FITS y eventos) servida como sitio estático en GitHub Pages. La foto no
cambia sola: se renueva cada vez que se lanza el despliegue, y la consola del panel muestra
`[ok] datos actualizados al <fecha UTC>`.

Para el despliegue con backend (Docker + Caddy en una VM de Oracle) ver [`README.md`](README.md) de esta carpeta.

```
GitHub Actions (a mano)                                   GitHub Pages
┌──────────────────────────────────────────────────┐      ┌────────────────────────────────┐
│ deploy/estatico.sh                               │      │ https://usuario.github.io/repo │
│  1. python -m app export ── JPL, Helioviewer, HEK │ ───▶ │  front + data/ (≈33 MB)        │
│  2. npm run build:static                         │      │  sin backend, sin /api         │
│  3. copia la foto en dist-static/data            │      └────────────────────────────────┘
└──────────────────────────────────────────────────┘
  caché de Actions: lasco_backend/data (SQLite + imágenes) → cada foto solo descarga lo nuevo
```

**Costo: 0.** GitHub Pages y GitHub Actions son gratis en repositorios **públicos** (en uno privado, Pages necesita
un plan de pago).

| Archivo | Qué hace |
|---|---|
| `.github/workflows/pages.yml` | workflow «Publicar en GitHub Pages»: exporta, compila y despliega |
| `deploy/estatico.sh` | construye el sitio en `lasco_test/dist-static/` (lo usa el workflow y sirve en el Mac) |
| `lasco_backend/app/export.py` | `python -m app export`: genera la foto de los datos |

Las imágenes **no se suben al repositorio**: `lasco_backend/data`, `lasco_backend/export` y `lasco_test/dist-static`
están en `.gitignore`. El sitio se publica como artefacto de Pages, así que el historial de git no crece con cada
foto.

---

## 1. Crear el repositorio en GitHub

1. En GitHub: **+ → New repository**.
2. **Repository name**: p. ej. `lasco` (será parte de la URL: `https://usuario.github.io/lasco/`).
3. **Public**.
4. **No** marques «Add a README», «.gitignore» ni «license»: el repositorio tiene que nacer vacío para subir el
   historial que ya existe.
5. **Create repository**.

> Si el repositorio se llama exactamente `usuario.github.io`, el panel queda en la raíz
> (`https://usuario.github.io/`). Con cualquier otro nombre queda en `/nombre/`; las dos formas funcionan sin tocar
> nada, porque el sitio usa rutas relativas.

## 2. Conectar el repositorio local y subirlo

Elige cómo autenticarte con GitHub (una sola vez):

- **Con la CLI de GitHub** (lo más simple): `brew install gh` y `gh auth login` (GitHub.com → HTTPS → navegador).
- **Con SSH**: agrega tu clave pública en **Settings → SSH and GPG keys** (si no tienes:
  `ssh-keygen -t ed25519`) y usa la URL `git@github.com:usuario/lasco.git`.

Luego, en la carpeta del proyecto:

```bash
git remote add origin https://github.com/usuario/lasco.git   # o git@github.com:usuario/lasco.git
git push -u origin main
git push -u origin develop
```

Comprueba en GitHub que aparecen las dos ramas y la carpeta `.github/workflows/`.

## 3. Activar GitHub Pages con GitHub Actions

En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

No hay que elegir rama ni carpeta: el workflow sube el sitio directamente.

## 4. Primer despliegue

1. Pestaña **Actions** → **Publicar en GitHub Pages** (columna izquierda) → **Run workflow** → rama `main` →
   **Run workflow**.
   - Desde la terminal: `gh workflow run pages.yml --ref main` y `gh run watch` para seguirlo.
2. El trabajo `construir`:
   - instala Python 3.13 y Node (versión de `lasco_test/.nvmrc`);
   - restaura la base del backend desde la caché de Actions (la primera vez está vacía);
   - corre `deploy/estatico.sh`: sincroniza las imágenes de 24 h y la malla de 6 h de 30 d, pide los encabezados FITS
     que falten, los eventos del HEK y las posiciones a JPL, y compila el front;
   - escribe un resumen (fecha de la foto, imágenes, eventos y avisos) en la página de la ejecución.
3. El trabajo `publicar` despliega el sitio. Al terminar, la URL aparece en la ejecución (y en **Settings → Pages**).

La **primera vez** tarda más (~5–15 min: descarga unas 350 imágenes en dos tamaños, ~350 encabezados y un mes de
eventos). Las siguientes, si la caché sigue viva, solo bajan lo nuevo (1–3 min).

## 5. Comprobar el sitio

Abre `https://usuario.github.io/lasco/` y verifica:

- La consola dice `[ok] datos actualizados al … UTC · versión estática · N imágenes`.
- Solo están las pestañas **24h** y **30d**, abre en 24h y no hay botón «actualizar».
- **play** recorre el timelapse; en pausa aparecen el detalle FITS, los eventos y los sectores de CME («ver»).
- En las herramientas del navegador (pestaña Red) no hay peticiones a `/api/`.

## 6. Actualizar los datos

Cada vez que quieras una foto nueva, repite el paso 4 (**Run workflow**). La fecha de la consola cambia a la de la
nueva exportación.

Cambios de código: se publican igual, lanzando el workflow sobre `main` después de integrar `develop` en `main` y
hacer push.

### Opcional: automatizarlo

En `.github/workflows/pages.yml` hay dos bloques comentados:

- `push: branches: [main]`: publica en cada push a `main` (código y datos nuevos).
- `schedule`: renueva la foto sola (p. ej. una vez al día). GitHub desactiva los workflows programados si el
  repositorio pasa **60 días sin actividad**; se reactivan desde la pestaña Actions.

## 7. Alternativa: publicar desde el Mac (sin Actions)

Útil si prefieres generar la foto con tu base local (`lasco_backend/data`, que ya tiene los encabezados).

1. **Settings → Pages → Source: Deploy from a branch** → rama `gh-pages`, carpeta `/ (root)` (la rama se crea en
   el paso siguiente; si aún no aparece, vuelve aquí después del primer push).
2. Construye y sube el sitio como **un solo commit en una rama aparte** (se reemplaza en cada publicación, así
   que no acumula historial):

   ```bash
   export PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"
   deploy/estatico.sh                      # exporta sobre lasco_backend/data y compila
   cd lasco_test/dist-static
   git init -q -b gh-pages
   git add -A
   git commit -q -m "Foto del $(date -u +%Y-%m-%dT%H:%MZ)"
   git push -f "$(git -C ../.. remote get-url origin)" gh-pages
   rm -rf .git
   cd ../..
   ```

Notas:

- `deploy/estatico.sh` sincroniza y aplica la retención sobre la base que usa, igual que «actualizar». No lo corras
  mientras el backend local sincroniza sobre la misma base.
- Las dos formas de publicar son excluyentes: Pages usa **o** GitHub Actions **o** la rama `gh-pages`, según lo
  elegido en **Settings → Pages**.

## 8. Opcional: dominio propio

1. En tu proveedor de DNS, crea un registro **CNAME** del subdominio (p. ej. `lasco.tudominio.com`) hacia
   `usuario.github.io`.
2. **Settings → Pages → Custom domain**: escribe `lasco.tudominio.com` → **Save**. Espera a que pase la verificación
   de DNS y marca **Enforce HTTPS**.

Con el despliegue por Actions no hace falta un archivo `CNAME` en el sitio. Como el panel usa rutas relativas, pasar
de `/lasco/` a la raíz de un dominio no requiere recompilar con otra base.

## 9. Límites y problemas frecuentes

| Tema | Detalle |
|---|---|
| Tamaño | Pages admite sitios de hasta **1 GB**; la foto ocupa ~33 MB |
| Tráfico | Límite blando de **~100 GB al mes**; una visita en 24h baja ~3 MB (≈4 MB más si abre 30d) |
| Despliegue | El paso de publicación expira a los 10 min (el sitio es pequeño: tarda segundos) |
| Caché vacía | Si pasan más de 7 días sin lanzar el workflow, GitHub borra la caché y la siguiente foto vuelve a descargar todo (solo tarda más) |
| `[!] eventos: no se pudo consultar el HEK` | El HEK falló en ese momento: el sitio se publica igual, con los eventos que hubo. Vuelve a lanzar el workflow |
| El workflow falla en «Exportar» | Sin posiciones completas de JPL Horizons la exportación se cancela y **no se publica nada** (el sitio anterior sigue en línea). Reintenta más tarde |
| 404 en la URL | Revisa **Settings → Pages → Source: GitHub Actions** y que la última ejecución terminó en verde |
| «Run workflow» no aparece | El workflow tiene que estar en la rama por defecto (`main`) del repositorio |
| Repositorio privado | Pages solo es gratis en repositorios públicos |

## 10. Créditos

El pie del panel ya incluye los créditos de los datos: imágenes SOHO/LASCO (cooperación internacional ESA/NASA) vía
Helioviewer, efemérides de JPL Horizons y eventos del HEK. Mantenlos al publicar.
