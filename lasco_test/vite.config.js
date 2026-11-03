import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Las APIs pasan por el proxy de Vite (en desarrollo y en `vite preview`):
// - JPL Horizons (posiciones de SOHO y la Tierra) no envía cabeceras CORS, así que el navegador no puede llamarla
//   directamente.
// - El backend propio (lasco_backend, FastAPI en el puerto 8000) sirve las imágenes LASCO desde disco. Al ser del
//   mismo origen, se pueden usar como texturas WebGL sin problemas. El front no descarga nada de Helioviewer.
const apiProxy = {
  '/api/horizons': {
    target: 'https://ssd.jpl.nasa.gov',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/horizons/, '/api/horizons.api'),
  },
  '/api/lasco': {
    target: 'http://127.0.0.1:8000',
    rewrite: (path) => path.replace(/^\/api\/lasco/, '/api'),
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
