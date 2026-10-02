import { defineConfig } from 'vite'

// Rutas relativas: el mismo build sirve en local y en
// https://fernandolizana.github.io/<repositorio>/ sin reescribir assets.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 800,
  },
})
