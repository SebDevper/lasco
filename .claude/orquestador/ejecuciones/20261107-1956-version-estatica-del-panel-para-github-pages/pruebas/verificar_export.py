"""Verifica una carpeta exportada por `python -m app export` (prueba desechable del tester)."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

out = sys.argv[1]
ok = True


def fail(msg):
    global ok
    ok = False
    print("  [FALLA]", msg)


def t(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def load(n):
    with open(os.path.join(out, n)) as f:
        return json.load(f)


# estructura exacta
top = sorted(os.listdir(out))
exp_top = ["events.json", "headers.json", "images", "images.json", "meta.json", "positions"]
print("estructura:", top)
if top != exp_top:
    fail(f"estructura distinta: {top}")
if sorted(os.listdir(os.path.join(out, "positions"))) != ["1d-15m.json", "30d-360m.json"]:
    fail("positions/ no tiene exactamente 1d-15m.json y 30d-360m.json")
if sorted(os.listdir(os.path.join(out, "images"))) != ["c2", "c3"]:
    fail("images/ no tiene solo c2 y c3")

meta = load("meta.json")
gen = t(meta["generatedAt"])
now = datetime.now(timezone.utc)
print("meta: format", meta["format"], "generatedAt", meta["generatedAt"], f"(hace {(now-gen).total_seconds()/60:.1f} min)")
if meta["format"] != 1 or meta["generator"] != "lasco_backend export":
    fail("format/generator")
if [(r["days"], r["stepMinutes"]) for r in meta["ranges"]] != [(1, 15), (30, 360)]:
    fail("rangos != 1d/15, 30d/360")

# posiciones
pos = {}
for r in meta["ranges"]:
    p = load(r["file"])
    s = p["samples"]
    times = [t(x["time"]) for x in s]
    n_exp = r["days"] * 1440 // r["stepMinutes"] + 1
    step = timedelta(minutes=r["stepMinutes"])
    aligned = all(int(x.timestamp()) % (r["stepMinutes"] * 60) == 0 for x in times)
    regular = all(b - a == step for a, b in zip(times, times[1:]))
    print(f"{r['file']}: {len(s)} muestras (esperadas {n_exp}), alineadas={aligned}, regulares={regular}, "
          f"{times[0]} → {times[-1]}")
    if len(s) != n_exp or not aligned or not regular or r["samples"] != len(s):
        fail(f"posiciones {r['file']}")
    if p["end"] != r["end"] and t(p["end"]) != times[-1]:
        print("  aviso: end del archivo", p["end"], "meta", r["end"])
    pos[r["days"]] = times

start30 = pos[30][0]
end30 = pos[30][-1]
start24, end24 = pos[1][0], pos[1][-1]

# imágenes
imgs = load("images.json")["images"]
heads = load("headers.json")
total = 0
referenced = set()
for inst in ("c2", "c3"):
    lst = imgs[inst]
    total += len(lst)
    ts = [t(x["time"]) for x in lst]
    if ts != sorted(ts):
        fail(f"{inst} no ordenado por tiempo")
    ids = [x["id"] for x in lst]
    if len(set(ids)) != len(ids):
        fail(f"{inst} ids repetidos")
    early = [x for x in lst if t(x["time"]) < start30 - timedelta(hours=6)]
    if early:
        fail(f"{inst}: {len(early)} imágenes anteriores a inicio30d-6h")
    for x in lst:
        if x["instrument"] != inst:
            fail(f"{x['id']} instrument")
        for size in ("512", "1024"):
            f = x["files"][size]
            path = os.path.join(out, f["url"])
            referenced.add(os.path.normpath(path))
            if not f["url"].startswith(f"images/{inst}/{x['id']}_{size}.jpg"):
                fail(f"url rara {f['url']}")
            if not os.path.isfile(path) or os.path.getsize(path) == 0:
                fail(f"no existe {f['url']}")
        if x["id"] not in heads:
            fail(f"sin encabezado {x['id']}")
    # 24h: todas las imágenes de la ventana
    in24 = [x for x in ts if start24 <= x <= end24]
    # 30d: imagen a < 3h de cada instante
    far = []
    for inst_t in pos[30]:
        d = min(abs(x - inst_t) for x in ts)
        if d > timedelta(hours=3):
            far.append((inst_t, d))
    print(f"{inst}: {len(lst)} imágenes, en 24h {len(in24)}, instantes de 30d con imagen a >3h: {len(far)}"
          f"{' p.ej. ' + str(far[0]) if far else ''}; primera {ts[0]}, última {ts[-1]}")
print("total imágenes", total, "· encabezados", len(heads), "· meta.counts", meta["counts"])
if len(heads) != total:
    fail("headers.json no tiene una entrada por imagen")

# archivos de images/ no referenciados
on_disk = set()
for inst in ("c2", "c3"):
    d = os.path.join(out, "images", inst)
    for n in os.listdir(d):
        on_disk.add(os.path.normpath(os.path.join(d, n)))
extra = on_disk - referenced
print("JPG en disco", len(on_disk), "referenciadas", len(referenced), "sobrantes", len(extra))
if extra:
    fail("hay JPG sobrantes")

# cobertura
for inst, spans in meta["coverage"].items():
    first = t(spans[0][0])
    print("coverage", inst, spans)
    if first < start30:
        fail(f"coverage {inst} empieza antes del inicio de 30d")

# eventos
ev = load("events.json")
ids = [e["id"] for e in ev["events"]]
starts = [t(e["start"]) for e in ev["events"]]
print(f"events: {len(ids)}, únicos {len(set(ids))}, error={ev['error']!r}, {min(starts)} → {max(starts)}, "
      f"ordenados={starts == sorted(starts)}; tipos {sorted(set(e['type'] for e in ev['events']))}")
if len(set(ids)) != len(ids) or starts != sorted(starts):
    fail("eventos repetidos o desordenados")
ends = [t(e["end"]) for e in ev["events"] if e.get("end")]
if min(starts) > start30 or max(ends) < end24 - timedelta(hours=12):
    print("  aviso: los eventos no cubren todo el período")
print("warnings:", meta["warnings"])
print("RESULTADO:", "OK" if ok else "FALLA")
