import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El backend propio (lasco_backend, FastAPI en el puerto 8000) pasa por el proxy de Vite (en desarrollo y en
// `vite preview`): sirve las posiciones de SOHO y la Tierra (las pide a JPL Horizons) y las imágenes LASCO desde
// disco. Al ser del mismo origen, las imágenes se pueden usar como texturas WebGL sin problemas. El front no habla
// con JPL ni con Helioviewer.
const apiProxy = {
  '/api/lasco': {
    target: 'http://127.0.0.1:8000',
    rewrite: (path) => path.replace(/^\/api\/lasco/, '/api'),
  },
}

// Modo estático (`npm run build:static`, variables de `.env.static`): el front lee una foto de los datos desde `data/`
// en vez del backend, para publicarlo sin servidor (GitHub Pages). La base relativa ('./') sirve en la raíz de un
// dominio o en una subcarpeta (`usuario.github.io/repo/`) sin conocer el nombre del repositorio: el panel es una sola
// página sin router. `vite build --base /ruta/` la reemplaza.
export default defineConfig(({ mode }) => ({
  base: mode === 'static' ? './' : '/',
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
}))
