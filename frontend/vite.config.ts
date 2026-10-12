import { defineConfig } from 'vite';

// Vite handles TSX directly. Add the React Fast Refresh plugin when needed.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
