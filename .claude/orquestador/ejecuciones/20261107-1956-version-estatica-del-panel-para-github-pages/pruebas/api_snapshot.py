"""Guarda respuestas de la API con TestClient (prueba desechable del tester). Uso: python api_snapshot.py OUTDIR (cwd = carpeta con app/)."""
import os, sys, json
from fastapi.testclient import TestClient
from app.main import app
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
urls = {
    "images": "/api/images?start=2026-11-03T00:00:00Z&end=2026-11-04T00:00:00Z",
    "images_c2": "/api/images?start=2026-11-03T00:00:00Z&end=2026-11-04T00:00:00Z&instrument=c2",
    "closest_c3": "/api/images/closest?instrument=c3&date=2026-11-03T12:00:00Z",
    "closest_c2": "/api/images/closest?instrument=c2&date=2026-10-20T12:00:00Z",
    "status": "/api/status",
    "header_404": "/api/images/999999999999/header",
    "images_400": "/api/images?start=x&end=y",
}
with TestClient(app) as c:
    for k, u in urls.items():
        r = c.get(u)
        body = r.content
        if k == "status":
            d = r.json(); d.pop("sync", None); body = json.dumps(d, sort_keys=True).encode()
        open(os.path.join(out, k), "wb").write(f"{r.status_code}\n".encode() + body)
print("ok", out)
