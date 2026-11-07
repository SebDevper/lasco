# Procesos del tester

| ronda | tipo | id | comando | puerto | estado |
|---|---|---|---|---|---|
| 1 | temporal | /var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.OmKimpdR5u | mktemp -d (LASCO_DATA_DIR backend 8001, caché vacía) | — | cerrado (borrado) |
| 1 | proceso | 11251 | LASCO_DATA_DIR=tmp.OmKimpdR5u LASCO_SYNC_ON_START=0 .venv/bin/uvicorn app.main:app --port 8001 | 8001 | cerrado |
| 1 | temporal | /var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.pUq6oLkBp4 | mktemp -d (LASCO_DATA_DIR de fallo_jpl.py, TestClient sin puerto) | — | cerrado (borrado) |
| 1 | temporal | /var/folders/9q/dfpsvs9n3sx5m9lw_w28_gd40000gn/T/tmp.40NHvLbBkO | mktemp -d (copia de data/lasco.sqlite3 para la migración) | — | cerrado (borrado) |
| 1 | proceso | 12667 | LASCO_DATA_DIR=tmp.OmKimpdR5u LASCO_SYNC_ON_START=0 .venv/bin/uvicorn app.main:app --port 8000 | 8000 | cerrado (para probar «backend apagado») |
| 1 | proceso | — | vite con Node 18 (falló al arrancar, no quedó proceso) | 5173 | cerrado |
| 1 | proceso | 12929 | ./node_modules/.bin/vite --port 5173 --strictPort (Node 26) | 5173 | cerrado |
| 1 | proceso | 13482 | Chrome headless --remote-debugging-pipe (navegador.py rangos; perfil en mktemp, lo cierra y borra el script) | — | cerrado (salió solo: fallo de arranque del script) |
| 1 | proceso | 13850 | Chrome headless --remote-debugging-pipe (navegador.py rangos, 2º intento; perfil en mktemp que borra el script) | — | cerrado (Browser.close, salida 0) |
| 1 | proceso | 14622 | Chrome headless --remote-debugging-pipe (navegador.py sin-backend) | — | cerrado (Browser.close, salida 0) |
| 1 | proceso | 14774 | LASCO_DATA_DIR=tmp.OmKimpdR5u LASCO_SYNC_ON_START=0 .venv/bin/uvicorn app.main:app --port 8000 (2º arranque) | 8000 | cerrado |
| 1 | proceso | 14984 | ./node_modules/.bin/vite preview --port 4173 --strictPort | 4173 | cerrado |
| 1 | temporal | /var/folders/…/T/tester-chrome-npqtmdio | perfil de Chrome del 1er intento fallido de navegador.py | — | cerrado (borrado) |
| 1 | colima | default | colima start (estaba apagado) | — | cerrado (colima stop) |
| 1 | docker | lasco (front + backend; volumen lasco_lasco_data ya existía) | docker compose up -d --build | 8080 | cerrado (docker compose down, sin -v; volumen conservado) |
| 1 | proceso | 18724 | Chrome headless --remote-debugging-pipe (navegador.py rangos contra 8080) | — | cerrado (Browser.close, salida 0) |
