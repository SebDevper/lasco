# Backend LASCO: FastAPI + uvicorn. Las imágenes y el índice SQLite van en /data (volumen).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LASCO_DATA_DIR=/data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Usuario sin privilegios, dueño de /data (un volumen nuevo hereda estos permisos).
RUN useradd --create-home --uid 1000 lasco \
    && mkdir -p /data \
    && chown lasco:lasco /data
USER lasco

VOLUME ["/data"]
EXPOSE 8000

# Al arrancar, el servidor consulta JPL Horizons antes de aceptar peticiones: dar margen.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/status', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
