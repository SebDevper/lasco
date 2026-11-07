"""Prueba desechable del tester: GET /api/positions con un JPL Horizons simulado (caído o con efemérides que terminan
antes de lo que dice la caché). Uso: LASCO_DATA_DIR=$(mktemp -d) LASCO_SYNC_ON_START=0 python fallo_jpl.py
(desde lasco_backend/, con el .venv)."""

import json
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient

import app.main as main
from app import horizons, positions

MODE = {"mode": "down", "limit": None}
QUERIES = []


def jd(dt):
    return dt.timestamp() / 86400 + 2440587.5


def handler(request: httpx.Request) -> httpx.Response:
    q = {k: v[0].strip("'") for k, v in parse_qs(urlparse(str(request.url)).query).items()}
    QUERIES.append((q.get("COMMAND"), q.get("START_TIME"), q.get("STOP_TIME"), q.get("STEP_SIZE")))
    if MODE["mode"] == "down":
        raise httpx.ConnectError("simulado: JPL caído", request=request)
    if MODE["mode"] == "503":
        return httpx.Response(503, text="<html>Service Unavailable</html>")
    start = datetime.strptime(q["START_TIME"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    stop = datetime.strptime(q["STOP_TIME"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    limit = MODE["limit"]
    if q["COMMAND"] == "-21" and limit and stop > limit:
        txt = f'No ephemeris for target "SOHO (spacecraft)" after A.D. {limit.strftime("%Y-%b-%d %H:%M").upper()}:09.1834 TDB'
        return httpx.Response(200, json={"result": txt})
    step = int(re.match(r"(\d+)", q["STEP_SIZE"]).group(1))
    lines, t = [], start
    while t <= stop:
        lines.append(f"{jd(t):.9f}, A.D. x, 1.0E+08, 2.0E+07, 3.0E+04, -20.0, 21.0, 0.01,")
        t += timedelta(minutes=step)
    return httpx.Response(200, json={"result": "cabecera\n$$SOE\n" + "\n".join(lines) + "\n$$EOE\nfin"})


main.new_client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


def reset(end_known=False, end_value=None, next_check=0.0, fill_retry=0.0):
    horizons._end_known, horizons._end_value, horizons._end_next_check = end_known, end_value, next_check
    positions._fill_retry_at = fill_retry
    QUERIES.clear()


def get(c, qs):
    t0 = time.monotonic()
    r = c.get(f"/api/positions?{qs}")
    dt = time.monotonic() - t0
    body = r.json()
    if r.status_code == 200:
        s = body["samples"]
        info = f"n={len(s)} end={body['end']} último==end:{s[-1]['time'] == body['end']}"
    else:
        info = json.dumps(body, ensure_ascii=False)
    return r.status_code, info, round(dt, 3), len(QUERIES)


with TestClient(main.app) as c:
    now = datetime.now(timezone.utc)
    print("ahora", now.isoformat())

    print("\n# S1: caché vacía, JPL caído (conexión rechazada)")
    reset(); MODE["mode"] = "down"
    print("  1ª:", get(c, "days=1&stepMinutes=15"))
    print("  2ª:", get(c, "days=1&stepMinutes=15"), "(consultas acumuladas en S1; esperado: sin nuevas)")

    print("\n# S1b: caché vacía, JPL responde 503 HTML")
    reset(); MODE["mode"] = "503"
    print("  1ª:", get(c, "days=1&stepMinutes=15"))

    print("\n# S2: fin en caché viejo ('hasta ahora') y las efemérides terminan hace 3 h → reintento con el límite")
    limit = (now - timedelta(hours=3)).replace(second=0, microsecond=0)
    MODE.update(mode="ok", limit=limit)
    reset(end_known=True, end_value=None, next_check=time.monotonic() + 3600)
    st = get(c, "days=1&stepMinutes=15")
    print("  límite simulado:", limit.isoformat(), "→ esperado end =", positions.floor_to_step(limit - timedelta(minutes=1), 15).isoformat())
    print("  1ª:", st)
    for qq in QUERIES:
        print("    consulta:", qq)
    print("  2ª:", get(c, "days=1&stepMinutes=15"), "(sin consultas nuevas)")

    print("\n# S3: TTL del fin vencido y JPL caído, con fin anterior y caché llena → 200 con el fin anterior")
    MODE["mode"] = "down"
    reset(end_known=True, end_value=limit - timedelta(minutes=1), next_check=0.0)
    print("  1ª:", get(c, "days=1&stepMinutes=15"))
    print("  2ª:", get(c, "days=1&stepMinutes=15"), "(sin consultas nuevas: espera de 5 min)")

    print("\n# S4: JPL caído y falta el inicio de la ventana (2 días) → 502")
    print("  1ª:", get(c, "days=2&stepMinutes=15"))

    print("\n# S5: JPL caído y falta el último instante → respuesta degradada sin él")
    MODE["mode"] = "down"
    later = limit + timedelta(minutes=16)  # el fin sube un paso: falta un instante al final
    reset(end_known=True, end_value=later, next_check=time.monotonic() + 3600)
    print("  1ª:", get(c, "days=1&stepMinutes=15"))
