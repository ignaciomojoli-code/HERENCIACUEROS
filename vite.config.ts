import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist-web', emptyOutDir: true },
  server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:3800' } },
});
