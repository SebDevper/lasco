# Resumen · Versión estática del panel para GitHub Pages

estado: completada · 2026-11-08 · rama `develop` · base en `solicitud.md`

## Objetivo

Publicar el panel sin servidor: una «foto» de los datos (posiciones, imágenes LASCO, eventos y encabezados FITS)
servida como sitio estático en GitHub Pages y actualizada con despliegues manuales, con el aviso «datos actualizados
al …». El modo con backend sigue igual. Ajustes del usuario al plan: en estático solo 24h y 30d, abre en 24h, la
fecha visible es la de la exportación, se mantienen los dos tamaños de imagen.

## Tareas (plan.md v2)

- [x] T1 `app/payloads.py`: `iso`/`image_json` fuera de `main.py` (la API responde igual, byte a byte).
- [x] T2 `Store`: `sample_images`, `images_by_ids`, `missing_headers` (sin cambios de esquema).
- [x] T3 `python -m app export [--out DIR]` (`app/export.py`): posiciones 24h/30d, sincronización, selección de la
      malla, encabezados reutilizando la tabla `headers` (solo pide los que faltan), eventos por tramos de 7 días con
      margen de 7 h, cobertura recortada, escritura atómica que nunca borra una carpeta ajena; salida 0/2/1.
- [x] T4 `export/` y `.export.*` ignorados en git y Docker.
- [x] T5 modo estático en el front: `.env.static`, `npm run build:static`, `base: './'`, `src/lib/datasource.js`.
- [x] T6 `positions.js` lee `data/positions/{días}d-{paso}m.json` en estático.
- [x] T7 `lasco.js`: cobertura, imágenes, timelapse, encabezados y eventos desde la foto.
- [x] T8 `Dashboard.jsx`/`LascoImages.jsx`: solo 24h y 30d, abre en 24h, sin «actualizar»,
      `[ok] datos actualizados al … · versión estática`, «reintentar» si falla la foto, créditos ESA/NASA y JPL.
- [x] T9 `deploy/estatico.sh [--base RUTA]`: exporta, compila y deja el sitio en `lasco_test/dist-static/`.
- [x] T10 documentación: `CLAUDE.md`, `README.md`, `lasco_backend/README.md`, `deploy/README.md`.

## Archivos cambiados

```
 M CLAUDE.md
 M README.md
 M deploy/README.md
 M lasco_backend/.dockerignore
 M lasco_backend/.gitignore
 M lasco_backend/README.md
 M lasco_backend/app/__main__.py
 M lasco_backend/app/main.py
 M lasco_backend/app/store.py
 M lasco_test/.dockerignore
 M lasco_test/.gitignore
 M lasco_test/package.json
 M lasco_test/src/components/LascoImages.jsx
 M lasco_test/src/lib/lasco.js
 M lasco_test/src/lib/positions.js
 M lasco_test/src/pages/Dashboard.jsx
 M lasco_test/vite.config.js
?? deploy/estatico.sh
?? lasco_backend/app/export.py
?? lasco_backend/app/payloads.py
?? lasco_test/.env.static
?? lasco_test/src/lib/datasource.js
```

## Rondas

| etapa | rondas | resultado |
|---|---|---|
| plan | 2 | v1 (10 tareas) → v2 con los cambios del usuario (24h/30d, abre en 24h) |
| desarrollo | 2 | ronda 1: T1–T10; ronda 2: comentarios menores #1–#4 |
| revisión | 2 | ronda 1: APROBADO con 4 menores (el orquestador decidió corregirlos antes de probar); ronda 2: APROBADO sin comentarios |
| pruebas | 1 | APROBADO: 41/41 casos (exportación, protección de `--out`, script, sitio en subcarpeta y raíz sin backend, modo con backend, Docker); limpieza ok |

## Datos de la foto (exportación real sobre una copia de la base)

346 imágenes (c2 151, c3 195), 32,2 MB; 467 eventos; 342 encabezados pedidos la primera vez (1 min 4 s en total).
Segunda exportación: 2,8 s, sin descargas ni encabezados nuevos, foto idéntica.

## Quedó pendiente (opcional)

- O1: el resumen de la exportación dice «[!] 1 avisos» con un solo aviso (plural).
- O2: sin red, el log muestra el traceback completo de httpx (viene de `Syncer`, comportamiento previo).
- O3: `/favicon.ico` da 404 en todos los modos (previo).
- `.claude/agents/revisor.md` sigue citando `floorToStep` (pendiente de la ejecución anterior).
- Fuera de alcance, para la próxima etapa: crear el repositorio en GitHub, publicar en Pages y el workflow manual de
  GitHub Actions.

## Efectos en el entorno durante las pruebas

- El tester reconstruyó las imágenes Docker y levantó el stack: al arrancar, el backend sincronizó en el volumen
  `lasco_lasco_data` y borró 4 imágenes de más de 180 días (comportamiento normal de `docker compose up`).
  Contenedores detenidos con `docker compose down` (sin `-v`); Colima sigue encendido, como estaba.
- `lasco_backend/data` no cambió (mismo md5 y 6.940 archivos).
- Para las pruebas en el navegador usó la extensión de Chrome (pestañas nuevas, ya cerradas); dejó el filtro guardado
  de `localhost:5173` como estaba.

## Cómo probarlo a mano

```bash
deploy/estatico.sh                       # exporta (sobre lasco_backend/data) y compila en lasco_test/dist-static/
cd lasco_test/dist-static && python3 -m http.server 4173
# http://localhost:4173 → abre en 24h, «datos actualizados al …», sin peticiones a /api
```

Ojo: `deploy/estatico.sh` y `python -m app export` sincronizan y aplican la retención sobre la base que usan (por
defecto `lasco_backend/data`), igual que el botón «actualizar».
