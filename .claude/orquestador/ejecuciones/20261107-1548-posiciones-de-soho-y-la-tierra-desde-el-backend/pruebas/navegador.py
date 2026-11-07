"""Prueba desechable del tester: maneja Chrome headless por CDP (--remote-debugging-pipe, sin abrir puertos) contra
http://localhost:5173 y registra consola, red y texto de la página.

Uso: python3 navegador.py <escenario> <dir_salida>
  rangos       carga, recorre 24h → 30d → 90d → 180d → 24h, pulsa «actualizar» en 24h y espera el timelapse
  sin-backend  carga con el backend apagado, espera el error, espera a que vuelva el 8000 y pulsa «reintentar»
"""

import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = os.environ.get("URL", "http://localhost:5173/")
scenario, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

profile = tempfile.mkdtemp(prefix="tester-chrome-")
r_ours, w_chrome = os.pipe()  # chrome escribe en fd 4
r_chrome, w_ours = os.pipe()  # chrome lee de fd 3
def _child_fds():
    a, b = os.dup(r_chrome), os.dup(w_chrome)  # por si alguno ya es 3 o 4
    os.dup2(a, 3, inheritable=True)
    os.dup2(b, 4, inheritable=True)


proc = subprocess.Popen(
    [CHROME, "--headless=new", "--remote-debugging-pipe", f"--user-data-dir={profile}", "--no-first-run",
     "--no-default-browser-check", "--window-size=1500,1100", "--enable-unsafe-swiftshader", "about:blank"],
    close_fds=False, stdout=subprocess.DEVNULL, stderr=open(f"{out}/chrome-stderr.log", "w"),
    preexec_fn=_child_fds,
)
print("chrome pid", proc.pid, flush=True)
os.close(r_chrome); os.close(w_chrome)
reader = os.fdopen(r_ours, "rb", buffering=0)
writer = os.fdopen(w_ours, "wb", buffering=0)

lock = threading.Lock()
next_id = [0]
pending = {}
events = []  # (t, method, params)
T0 = time.monotonic()


def read_loop():
    buf = b""
    while True:
        chunk = reader.read(65536)
        if not chunk:
            return
        buf += chunk
        while b"\0" in buf:
            raw, buf = buf.split(b"\0", 1)
            msg = json.loads(raw)
            if "id" in msg:
                ev = pending.pop(msg["id"], None)
                if ev:
                    ev[1] = msg
                    ev[0].set()
            else:
                events.append((round(time.monotonic() - T0, 2), msg.get("method"), msg.get("params", {})))


threading.Thread(target=read_loop, daemon=True).start()


def send(method, params=None, session=None, timeout=30):
    with lock:
        next_id[0] += 1
        i = next_id[0]
    ev = [threading.Event(), None]
    pending[i] = ev
    msg = {"id": i, "method": method, "params": params or {}}
    if session:
        msg["sessionId"] = session
    writer.write(json.dumps(msg).encode() + b"\0")
    if not ev[0].wait(timeout):
        raise TimeoutError(method)
    if "error" in ev[1]:
        raise RuntimeError(f"{method}: {ev[1]['error']}")
    return ev[1].get("result", {})


target = send("Target.createTarget", {"url": "about:blank"})["targetId"]
S = send("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
for dom in ("Page", "Runtime", "Network", "Log"):
    send(f"{dom}.enable", session=S)
send("Emulation.setDeviceMetricsOverride", {"width": 1500, "height": 1100, "deviceScaleFactor": 1, "mobile": False}, session=S)


def js(expr, timeout=30):
    r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}, session=S, timeout=timeout)
    return r.get("result", {}).get("value")


def text():
    return js("document.body.innerText") or ""


def wait_for(pred_js, timeout=90):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if js(pred_js):
            return True
        time.sleep(0.5)
    return False


def shot(name):
    data = send("Page.captureScreenshot", {"format": "png"}, session=S)["data"]
    with open(f"{out}/{name}.png", "wb") as f:
        f.write(base64.b64decode(data))


def click_button(label):
    return js(f"""(() => {{ const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === {json.dumps(label)});
      if (!b) return false; b.click(); return true; }})()""")


def status_line():
    return js("""(() => { const t = document.body.innerText.split('\\n');
      return t.filter(l => /consultando posiciones|efemérides|\\[error\\]|# requiere|# las posiciones|timelapse:|\\[sync\\]/.test(l)).join(' | '); })()""")


def mark(label):
    events.append((round(time.monotonic() - T0, 2), "MARK", {"label": label}))
    print(f"[{round(time.monotonic() - T0, 1)}s] {label}", flush=True)


OK_JS = "document.body.innerText.includes('(vía backend) · último dato')"
LOADING_JS = "document.body.innerText.includes('consultando posiciones')"

report = {}
try:
    send("Page.navigate", {"url": URL}, session=S)
    if scenario == "rangos":
        mark("carga inicial (24h por defecto)")
        ok = wait_for(f"{OK_JS} && !{LOADING_JS}", 90)
        time.sleep(3)
        report["carga"] = {"ok": ok, "estado": status_line()}
        shot("01-24h")
        for i, r in enumerate(["30d", "90d", "180d", "24h"], start=2):
            mark(f"cambio a {r}")
            click_button(r)
            time.sleep(0.3)
            ok = wait_for(f"{OK_JS} && !{LOADING_JS}", 90)
            time.sleep(2)
            report[r + f"#{i}"] = {"ok": ok, "estado": status_line()}
            shot(f"0{i}-{r}")
        if os.environ.get("SIN_ACTUALIZAR"):
            raise SystemExit(0)
        mark("actualizar en 24h")
        click_button("actualizar")
        # espera a que termine el sync y se carguen las imágenes del timelapse
        wait_for("/\\[sync\\]/.test(document.body.innerText)", 20)
        done = wait_for("!/\\[sync\\]/.test(document.body.innerText) && /timelapse: [1-9]/.test(document.body.innerText)", 300)
        time.sleep(5)
        report["actualizar"] = {"ok": done, "estado": status_line()}
        shot("07-actualizar")
        report["texto_final"] = text()[:4000]
    elif scenario == "sin-backend":
        mark("carga con el backend apagado")
        ok = wait_for("document.body.innerText.includes('no se pudieron cargar las efemérides')", 60)
        time.sleep(1)
        report["error"] = {"ok": ok, "estado": status_line(), "texto": text()[:1500]}
        shot("10-sin-backend")
        mark("esperando a que el backend vuelva al 8000")
        end = time.monotonic() + 240
        while time.monotonic() < end:
            try:
                socket.create_connection(("127.0.0.1", 8000), timeout=1).close()
                break
            except OSError:
                time.sleep(1)
        time.sleep(2)
        mark("reintentar")
        report["boton_reintentar"] = click_button("reintentar")
        ok = wait_for(f"{OK_JS} && !{LOADING_JS}", 90)
        time.sleep(2)
        report["tras_reintentar"] = {"ok": ok, "estado": status_line()}
        shot("11-reintentar")
finally:
    with open(f"{out}/eventos-{scenario}.json", "w") as f:
        json.dump(events, f, ensure_ascii=False, indent=0, default=str)
    with open(f"{out}/informe-{scenario}.json", "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    try:
        send("Browser.close", timeout=5)
    except Exception:
        pass
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    shutil.rmtree(profile, ignore_errors=True)
    print("chrome cerrado", proc.poll(), flush=True)
    print(json.dumps({k: v for k, v in report.items() if k != "texto_final"}, ensure_ascii=False, indent=1))
