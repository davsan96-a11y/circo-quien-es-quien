import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funciona en GitHub Pages (subcarpeta) y en local, con routing por hash
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: ['es2020', 'safari15'] },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
