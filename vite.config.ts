import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000', '/socket.io': { target: 'http://localhost:4000', ws: true } } },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (/node_modules\/gsap\//.test(id)) return 'motion-vendor';
          if (/node_modules\/lenis\//.test(id)) return 'scroll-vendor';
          if (/node_modules\/socket\.io-client\//.test(id) || /node_modules\/(engine\.io-client|socket\.io-parser|engine\.io-parser|@socket\.io\/component-emitter)\//.test(id)) return 'realtime-vendor';
          if (/node_modules\/lucide-react\//.test(id)) return 'icons-vendor';
        },
      },
    },
  },
});
