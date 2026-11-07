import json, sys, collections
ev = json.load(open(sys.argv[1]))
reqs = {}
print("== marcas, peticiones a /api/ (salvo /api/files) y consola ==")
for t, m, p in ev:
    if m == "MARK":
        print(f"{t:7} ---- {p['label']}")
    elif m == "Network.requestWillBeSent":
        u = p["request"]["url"]; reqs[p["requestId"]] = u
        if "/api/" in u and "/api/files/" not in u:
            print(f"{t:7} REQ {p['request']['method']} {u.replace('http://localhost:5173','')}")
    elif m == "Network.responseReceived":
        u = p["response"]["url"]
        if "/api/" in u and "/api/files/" not in u and "/status" not in u:
            print(f"{t:7} RES {p['response']['status']} {u.replace('http://localhost:5173','')}")
    elif m == "Network.loadingFailed":
        print(f"{t:7} FALLO red {reqs.get(p['requestId'])} {p.get('errorText')} canceled={p.get('canceled')}")
    elif m == "Runtime.consoleAPICalled":
        print(f"{t:7} CONSOLE.{p['type']}:", " ".join(str(a.get('value', a.get('description', ''))) for a in p['args'])[:300])
    elif m == "Runtime.exceptionThrown":
        print(f"{t:7} EXCEPCIÓN:", json.dumps(p['exceptionDetails'])[:400])
    elif m == "Log.entryAdded":
        e = p["entry"]; print(f"{t:7} LOG {e['level']} {e.get('source')}: {e['text'][:200]} {e.get('url','')}")
hosts = collections.Counter(u.split('/')[2] for u in reqs.values() if u.startswith('http'))
print("hosts:", dict(hosts))
st = collections.Counter()
for t, m, p in ev:
    if m == "Network.responseReceived":
        st[p['response']['status']] += 1
print("códigos HTTP:", dict(st))
print("peticiones a /api/horizons:", sum('/api/horizons' in u for u in reqs.values()))
print("peticiones a jpl.nasa.gov:", sum('jpl.nasa.gov' in u for u in reqs.values()))
