import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/circuitos/',
  build: {
    outDir: '../static',
    emptyOutDir: true
  }
})
