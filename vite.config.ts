import { defineConfig, type Plugin } from 'vite';
import roomsApiHandler from './api/rooms';

function mochessApiPlugin(): Plugin {
  return {
    name: 'mochess-online-api-middleware',
    configureServer(server) {
      server.middlewares.use('/api/rooms', (req, res) => {
        void roomsApiHandler(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/rooms', (req, res) => {
        void roomsApiHandler(req, res);
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [mochessApiPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          chess: ['chess.js']
        }
      }
    }
  },
  worker: {
    format: 'es'
  }
});
