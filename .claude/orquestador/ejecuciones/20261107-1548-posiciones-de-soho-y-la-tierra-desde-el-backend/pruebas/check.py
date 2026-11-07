import json, sys
from datetime import datetime, timezone
path, days, step = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = json.load(open(path))
s = d["samples"]
ts = [datetime.fromisoformat(x["time"].replace("Z", "+00:00")) for x in s]
end = datetime.fromisoformat(d["end"].replace("Z", "+00:00"))
now = datetime.now(timezone.utc)
grid = all(int(t.timestamp()) % (step*60) == 0 for t in ts)
contig = all((b - a).total_seconds() == step*60 for a, b in zip(ts, ts[1:]))
print(f"days={d['days']} step={d['stepMinutes']} n={len(s)} esperado={days*1440//step+1} end={d['end']} "
      f"ultimo==end:{ts[-1]==end} end<=ahora:{end<=now} end_en_malla:{int(end.timestamp())%(step*60)==0} "
      f"malla:{grid} contiguo:{contig} primero={s[0]['time']} lenvec={len(s[0]['soho'])},{len(s[0]['earth'])}")
