---
name: orquestar
description: Orquesta un cambio en super_project con agentes (planificador → desarrollador ⇄ revisor → tester, volviendo a desarrollo si algo falla) y deja todo registrado en .claude/orquestador/ejecuciones/. Usar cuando el usuario pida ejecutar un cambio con el orquestador o con los agentes.
argument-hint: "<solicitud>"
---

# Orquestador de agentes

Tú (la sesión principal) eres el **orquestador**. Los subagentes no pueden lanzar otros subagentes, así que todo
pasa por ti: lanzas cada agente con la herramienta Agent (`subagent_type`: `planificador`, `desarrollador`,
`revisor`, `tester`), lees su respuesta, decides la siguiente etapa y registras cada paso. Lee primero
`.claude/orquestador/README.md`.

Solicitud del usuario: $ARGUMENTS

## Comunicación

- **Ida**: el prompt de cada agente incluye siempre `RUN=<ruta>`, la etapa, el número de ronda y los archivos que
  tiene que leer. Los agentes empiezan en frío: no supongas que saben nada que no esté en el prompt o en `RUN/`.
- **Vuelta**: cada agente termina con un bloque `ESTADO / ARCHIVO / RESUMEN / PREGUNTAS`. Decide con `ESTADO`; lee
  el `ARCHIVO` si necesitas el detalle.
- **Entre agentes**: hablan a través de los archivos de `RUN/` (el desarrollador responde cada comentario del revisor
  en `desarrollo/ronda-N.md`; el revisor lee esas respuestas en la ronda siguiente; el tester describe los fallos para
  el desarrollador). Tú solo les pasas las rutas.
- **Continuidad**: para la siguiente ronda del mismo agente usa SendMessage con su id/nombre, para que conserve
  el contexto. Si no se puede (terminó, no aparece en ListAgents), lanza uno nuevo: los archivos de `RUN/` bastan.
- Los agentes corren en segundo plano: espera su notificación, no inventes ni adelantes resultados.

## Bitácora

Comando: `python3 .claude/orquestador/bitacora.py`. Registra **cada** decisión tuya como `orquestador`
(`etapa`, `decisión`, `pregunta`), y las respuestas del usuario como `usuario`. Los agentes registran lo suyo.

## Flujo

0. **Preparar**
   - Comprueba `git branch --show-current` = `develop` (si no, pregunta al usuario) y mira `git status`. Si hay
     cambios sin commitear, avisa al usuario antes de seguir: se mezclarían con los de la ejecución.
   - `RUN=$(python3 .claude/orquestador/bitacora.py nueva "<título corto en español>")`.
   - Copia la solicitud, textual, en «Solicitud del usuario» de `RUN/solicitud.md`, más el contexto relevante de la
     conversación (decisiones ya tomadas por el usuario).

1. **Planificar** → agente `planificador`.
   - `BLOQUEADO`: haz las preguntas al usuario (AskUserQuestion), anota preguntas y respuestas en «Aclaraciones» de
     `solicitud.md`, registra y vuelve a llamar al planificador.
   - `OK`: muestra al usuario un resumen del plan (tareas en una línea cada una + enlace a `RUN/plan.md`) y **espera
     su aprobación** antes de codificar, salvo que haya dicho que siga sin preguntar. Si pide cambios, vuelven al
     planificador.

2. **Desarrollar** (ronda `D`, contador global desde 1) → agente `desarrollador`.
   - Primera vez: «implementa `RUN/plan.md`». Correcciones: «atiende `RUN/revisiones/ronda-R.md`» o «atiende
     `RUN/pruebas/ronda-P.md`».
   - `BLOQUEADO`: pregunta al usuario, registra, continúa.

3. **Revisar** (ronda `R`, contador global) → agente `revisor`.
   - `CAMBIOS` → vuelve a 2 con ese informe.
   - `APROBADO` → 4.
   - Máximo **4 rondas de revisión seguidas** sin aprobación: para, muestra al usuario los comentarios que siguen
     pendientes y pregunta cómo seguir.

4. **Probar** (ronda `P`, contador global) → agente `tester`.
   - **Antes** de lanzarlo: `python3 .claude/orquestador/bitacora.py entorno RUN "orquestador-antes-P"`.
   - **Al volver** (con cualquier estado, también si se interrumpió o falló), haz la verificación de limpieza de
     abajo antes de decidir nada.
   - `FALLA` → vuelve a 2 con `RUN/pruebas/ronda-P.md`; la corrección pasa **otra vez por revisión** (3) y luego
     por pruebas (4).
   - `BLOQUEADO` → pregunta al usuario (p. ej. si puede detener servicios en 5173/8000).
   - `APROBADO` → 5.
   - Máximo **3 rondas de pruebas** fallidas: para y pregunta al usuario.

   **Verificación de limpieza** (después de cada ronda del tester):
   1. `… bitacora.py entorno RUN "orquestador-despues-P"` y compáralo con `orquestador-antes-P`.
   2. Sin diferencias → registra `orquestador limpieza "ronda P: ok"` y sigue.
   3. Con diferencias → cierra solo lo que cumpla **las dos** condiciones: está en `RUN/pruebas/procesos.md` con
      estado distinto de `cerrado`, y no aparecía en la foto de antes (un PID que ya existía antes no es del tester,
      aunque coincida). Procesos: `kill <PID>`, y `kill -9` si a los 5 s sigue vivo. Contenedores: `docker compose
      down` (nunca `-v`) solo si en la foto de antes no había contenedores del proyecto. Directorios temporales de
      la tabla: `rm -rf` solo si la ruta está bajo `$TMPDIR` o `/tmp`. Pestañas: ciérralas si tienes las herramientas
      del navegador; si no, avísalo al usuario.
   4. Actualiza esas filas de `procesos.md` (`cerrado por el orquestador`) y registra
      `orquestador limpieza "ronda P: cerré …"`.
   5. Si queda algo que no está en `procesos.md` (no sabes quién lo arrancó), **no lo toques**: díselo al usuario y
      regístralo.

5. **Cerrar**
   - Escribe `RUN/resumen.md`: objetivo, tareas hechas, archivos cambiados (`git status --short`), rondas
     (D/R/P), comentarios menores que quedaron opcionales, cómo probarlo a mano.
   - `python3 .claude/orquestador/bitacora.py cerrar RUN completada "<resumen en una línea>"` (o `bloqueada` /
     `cancelada` si se interrumpe).
   - Informa al usuario: qué se hizo, enlace a `RUN/resumen.md` y `RUN/bitacora.md`. **No hagas commit**: propón el
     mensaje y espera su aprobación explícita (regla del proyecto; también para push y merge).

## Reglas

- No escribes código del proyecto tú mismo: si algo hay que cambiar, va por el desarrollador (y luego revisión y
  pruebas). Sí puedes editar los archivos de `RUN/` que te tocan (`solicitud.md`, `resumen.md`).
- No te saltes etapas, aunque el cambio parezca trivial, salvo que el usuario lo pida (y regístralo).
- Mantén al usuario al tanto con una línea por transición (`[plan] 5 tareas`, `[revisión 2] CAMBIOS: 1 importante`…).
