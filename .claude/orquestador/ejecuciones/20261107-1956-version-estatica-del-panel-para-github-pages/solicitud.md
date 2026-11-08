# Versión estática del panel para GitHub Pages

- inicio: 2026-11-07 19:56:15 UTC
- rama: `develop`
- commit base: `31673758e72183f6050e74daea7df3eba23774a2`

## Estado de git al empezar

```
(limpio)
```

## Solicitud del usuario

Mensajes del usuario (2026-11-07), textuales:

> Estaba pensando en algo, hay una manera de acumular todos los datos en un front con info estática y subirlo a
> github pages? Guardando todas las imágenes del rango pero sin que cambien. Después de manera manual puedo ir
> haciendo despliegues manuales. Podríamos agregar alguna info que diga: "Datos actualizados al (fecha de subida)".
> Que te parece la idea?

> y no se pueden usar los encabezados que ya tenemos guardados y solo pedir los nuevos?

> perfecto. Entonces pídele al orquestador que prepare el plan para aprobarlo. Después veremos como subirlo y
> configurar github actions

## Contexto de la conversación

- Motivo: el usuario tiene problemas para crear la cuenta de Oracle (despliegue actual con Docker + Caddy en una VM).
  Se evaluaron alternativas gratuitas (Google Cloud e2-micro, Northflank, Render, Koyeb, Cloudflare Workers/R2, AWS
  Lambda) y el usuario propuso una versión estática: una «foto» de los datos publicada en GitHub Pages, actualizada
  con despliegues manuales.
- Propuesta del orquestador, aceptada por el usuario:
  1. **Backend**: un comando de exportación (p. ej. `python -m app export`) que use la sincronización existente y
     genere una carpeta estática: posiciones de cada rango (RANGES: 24h paso 15 min, 30d/90d/180d paso 6 h),
     lista de imágenes por instante/cobertura, eventos (CME y fulguraciones) del periodo, encabezados FITS, JPG y un
     `meta.json` con la fecha de la foto.
  2. **Front**: un modo estático elegido al compilar (variable de entorno de Vite) que lea esos archivos en vez de la
     API. En ese modo, el botón «actualizar» y el seguimiento de la sincronización se reemplazan por
     `[ok] datos actualizados al <fecha UTC>`. **El modo con backend se mantiene** (por si Oracle funciona después).
  3. Créditos de las imágenes (SOHO/LASCO, cooperación ESA/NASA, vía Helioviewer).
  4. Vite necesitará `base` configurable si el sitio queda en `usuario.github.io/repo/`.
- Encabezados FITS: Helioviewer no tiene endpoint por rango (`getJP2Header` es por `id`; verificado en la referencia
  de la API v2). Cada petición tarda ~0,74 s y pesa ~3,9 KB; Helioviewer no envía cabeceras CORS (el navegador no
  puede pedirlos: hay que precalcularlos). La base local tiene hoy 7 encabezados para 3.470 imágenes (solo se piden
  al pausar). Decisión: **reutilizar la tabla `headers` y pedir solo los que falten**. Opción a evaluar en el plan:
  que la sincronización pida el encabezado de cada imagen nueva al descargarla, para que la exportación no tenga que
  pedir nada.
- Tamaño: `lasco_backend/data` ocupa ~319 MB; GitHub Pages admite sitios de hasta 1 GB y ~100 GB/mes de tráfico.
  Se puede evaluar dejar solo 512 px en rangos largos si hiciera falta.
- **Fuera de alcance de esta ejecución** (el usuario lo verá después): crear el repositorio en GitHub, subirlo y
  configurar GitHub Actions / Pages. Recomendación previa del orquestador para entonces: no commitear las imágenes
  (inflarían el historial); publicar como artefacto de Pages desde un workflow manual (`workflow_dispatch`) o con un
  script local. El plan puede dejar preparado lo necesario para eso (p. ej. un script de construcción del sitio
  estático) pero no el workflow.
- Hay que mantener las reglas del proyecto: malla fija (`floor_to_step`), textos en español con tono de terminal,
  sin saltos de layout, fechas en UTC con `fmtDateTime`, documentación al día.

## Aclaraciones

<!-- preguntas al usuario y sus respuestas, con fecha -->

- 2026-11-08 · Respuesta del usuario al plan (textual): «Con respecto al rango, creo que sería bueno dejarlo a un
  maximo de 30 días. Así ahorramos espacio, también me parece bien que se abra seleccionando las últimas 24 horas. Lo
  de la fecha visible me parece bien. Y de momento no toquemos el tema del tamaño de la imagen.»
  Interpretación del orquestador (en el contexto de la versión estática, que es la que ocupa espacio):
  - la exportación y el modo estático solo incluyen los rangos 24h y 30d (no 90d ni 180d);
  - en modo estático, el panel abre en 24h;
  - el modo con backend no cambia (sigue con 24h/30d/90d/180d y su rango por defecto actual);
  - fecha visible = momento de la exportación (`generatedAt`), aprobado;
  - se exportan los dos tamaños de imagen (512 y 1024 px), sin cambios.
