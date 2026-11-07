# Orquestador de agentes

Flujo para hacer cambios en super_project con varios agentes de Claude Code. Se lanza desde la sesión principal con
`/orquestar <solicitud>` (o pidiendo «ejecútalo con el orquestador»).

```
                ┌──────────────────────────── orquestador (sesión principal, skill /orquestar) ───────────────────────────┐
solicitud ──▶ planificador ──▶ [aprobación del usuario] ──▶ desarrollador ──▶ revisor ──APROBADO──▶ tester ──APROBADO──▶ cierre
                                                               ▲      ▲           │                      │
                                                               │      └─CAMBIOS───┘                      │
                                                               └────────────── FALLA (vuelve a revisión) ┘
```

| agente | archivo | hace | escribe en |
|---|---|---|---|
| orquestador | `.claude/skills/orquestar/SKILL.md` | lanza a los demás, decide la siguiente etapa, habla con el usuario | `solicitud.md`, `resumen.md` |
| planificador | `.claude/agents/planificador.md` | analiza la solicitud y el código, escribe la lista de tareas | `plan.md` |
| desarrollador | `.claude/agents/desarrollador.md` | solo codifica: tareas del plan y correcciones | código + `desarrollo/` |
| revisor | `.claude/agents/revisor.md` | revisión exhaustiva, veredicto APROBADO / CAMBIOS | `revisiones/` |
| tester | `.claude/agents/tester.md` | build, API, navegador, Docker; veredicto APROBADO / FALLA | `pruebas/` |

Los subagentes de Claude Code no pueden lanzar otros subagentes: por eso el orquestador es la sesión principal y la
comunicación es en estrella. Los agentes se hablan entre sí a través de los archivos de la ejecución (el
desarrollador responde cada comentario del revisor; el revisor lee esas respuestas en la ronda siguiente).

Procesos de prueba: el tester anota en `pruebas/procesos.md` cada proceso, contenedor, directorio temporal y pestaña
que abre (justo al abrirlo) y lo cierra al terminar. El orquestador saca una foto de puertos (5173, 4173, 8000, 8001,
8080) y contenedores antes y después de cada ronda de pruebas (`bitacora.py entorno`). Si queda algo nuevo, lo cierra,
pero solo si figura en `procesos.md`. Lo que no figure ahí no se toca y se avisa al usuario.

Límites: 4 rondas de revisión seguidas y 3 rondas de pruebas fallidas; al llegar, el orquestador pregunta al usuario.
Nadie hace commit, push ni merge: el orquestador propone el commit al final y espera la aprobación del usuario.

## Registro de cada ejecución

```
.claude/orquestador/ejecuciones/
├── INDICE.md                         # todas las ejecuciones y su estado
└── 20261107-1400-<título>/
    ├── bitacora.md                   # log cronológico: hora UTC · agente · evento · detalle
    ├── solicitud.md                  # solicitud textual, rama, commit base, aclaraciones
    ├── plan.md                       # tareas (se marcan [x] al hacerlas) y plan de pruebas
    ├── desarrollo/ronda-N.md         # qué cambió el desarrollador y respuesta a cada comentario
    ├── revisiones/ronda-N.md         # comentarios numerados con severidad y veredicto
    ├── pruebas/ronda-N.md            # casos, resultados, fallos reproducibles, limpieza
    ├── pruebas/procesos.md           # todo lo que arrancó el tester y si quedó cerrado
    ├── pruebas/*-antes-N.txt …       # fotos de puertos y contenedores (bitacora.py entorno)
    └── resumen.md                    # cierre
```

`bitacora.py` mantiene el formato (todos los agentes lo usan):

```bash
python3 .claude/orquestador/bitacora.py lista             # índice de ejecuciones
python3 .claude/orquestador/bitacora.py ver               # bitácora de la última ejecución
python3 .claude/orquestador/bitacora.py ver <ejecución>
python3 .claude/orquestador/bitacora.py nueva "<título>"                       # imprime la ruta RUN
python3 .claude/orquestador/bitacora.py registrar RUN <agente> <evento> "<detalle>"
python3 .claude/orquestador/bitacora.py cerrar RUN completada|bloqueada|cancelada ["<detalle>"]
python3 .claude/orquestador/bitacora.py entorno RUN "<nombre>"                 # foto de puertos y contenedores
```

Agentes válidos en la bitácora: `orquestador`, `planificador`, `desarrollador`, `revisor`, `tester`, `usuario`.
