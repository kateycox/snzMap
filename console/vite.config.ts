import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Three entries. /add and /review are deliberately separate small pages rather than
    // routes inside the map app, so the upload path never loads MapLibre and a change to
    // either page cannot touch the map bundle.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        add: resolve(__dirname, 'add.html'),
        review: resolve(__dirname, 'review.html'),
      },
    },
  },
  // The MapLibre tile-worker fix lives in main.tsx (`setWorkerUrl` + a `?url` import),
  // not here. An earlier fix excluded maplibre-gl from the dep optimizer, which papered
  // over the same silent-worker failure in dev only — `optimizeDeps` has no effect on
  // `vite build`, so production still shipped without the worker file and the map went
  // blank with no console error. The entry-point fix covers both dev and prod.
});
