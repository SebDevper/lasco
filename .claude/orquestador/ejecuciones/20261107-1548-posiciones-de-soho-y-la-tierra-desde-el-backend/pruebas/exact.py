import json, sys
d = {x["time"]: x for x in json.load(open("p1.json"))["samples"]}
for tgt, key in (("-21", "soho"), ("399", "earth")):
    txt = open(f"jpl{tgt}.txt").read()
    body = txt.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    for line in body:
        f = [c.strip() for c in line.split(",")]
        jd = float(f[0]); vals = [float(v) for v in f[2:8]]
        ms = round((jd - 2440587.5) * 86400) * 1000
        from datetime import datetime, timezone
        iso = datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z")
        if iso in d:
            b = d[iso][key]
            dp = max(abs(a - c) for a, c in zip(vals[:3], b[:3])); dv = max(abs(a - c) for a, c in zip(vals[3:], b[3:]))
            print(key, iso, f"dpos={dp:.6f} km  dvel={dv:.2e} km/s", "OK" if dp <= 0.001 and dv <= 1e-6 else "FUERA")
