import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The front end's build.
 *
 * The application is a directory of its own under `src/web/ui`, built into
 * `dist/ui`, which is where the server looks for it. Asset file names carry
 * a content hash, which is what lets the server cache them for ever (see
 * `policyFor` in the static handler).
 */
export default defineConfig({
  root: 'src/web/ui',
  plugins: [react()],
  build: {
    outDir: '../../../dist/ui',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
        // React and the charting library change when they are upgraded and
        // not before; the application changes every commit. Splitting them
        // means a deploy re-downloads the small half.
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: { port: 5175, strictPort: true },
});
