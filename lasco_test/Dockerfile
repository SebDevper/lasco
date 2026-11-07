# Front: se compila con Node y se sirve con nginx.
# nginx hace en el contenedor lo que el proxy de Vite hace en desarrollo (ver nginx.conf.template):
#   /api/lasco/ → backend (posiciones e imágenes)

# ── 1) Compilación ──
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── 2) Servidor ──
FROM nginx:1.29-alpine
# La imagen oficial de nginx sustituye las variables de entorno de /etc/nginx/templates/*.template al arrancar.
ENV BACKEND_URL=http://backend:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
