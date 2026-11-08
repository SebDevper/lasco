# Procesos del tester

| ronda | tipo | id | comando | puerto | estado |
|---|---|---|---|---|---|
| 1 | temporal | /var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.xauMNJ72vY | mktemp -d + cp -cR lasco_backend/data (LASCO_DATA_DIR=/var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.xauMNJ72vY/data, exportaciones en /var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.xauMNJ72vY) | — | borrado |
| 1 | proceso | 52441 | LASCO_DATA_DIR=<copia> LASCO_SYNC_ON_START=0 .venv/bin/uvicorn app.main:app --port 8001 | 8001 | cerrado |
| 1 | temporal | lasco_backend/export, lasco_test/dist-static | deploy/estatico.sh (salidas generadas, ignoradas por git) | — | borrado |
| 1 | proceso | 53927 | python3 -m http.server 4173 --bind 127.0.0.1 -d /var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.xauMNJ72vY/www (sitio estático en /repo/) | 4173 | cerrado |
| 1 | proceso | 53928 | python3 -m http.server 5173 --bind 127.0.0.1 -d /var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.xauMNJ72vY/site-rel (sitio estático en la raíz) | 5173 | cerrado |
| 1 | pestaña | 1068295217 | pestaña vacía creada por tabs_context_mcp (grupo MCP nuevo) | — | cerrada |
| 1 | pestaña | 1068295218 | http://127.0.0.1:4173/repo/ y demás | — | cerrada |
| 1 | proceso | 55762 | LASCO_DATA_DIR=<copia> LASCO_SYNC_ON_START=0 .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 | 8000 | cerrado |
| 1 | proceso | 55763 | ./node_modules/.bin/vite --port 5173 (sin Node 26 en PATH: murió al arrancar) | 5173 | cerrado (no llegó a arrancar) |
| 1 | proceso | 55896 | ./node_modules/.bin/vite --port 5173 --strictPort | 5173 | cerrado |
| 1 | docker | lasco | docker compose build + docker compose up -d | 8080 | cerrado (down, sin -v) |
