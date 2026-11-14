import { defineConfig, type Plugin } from 'vite';
import { appendFileSync, mkdirSync } from 'node:fs';

/** Reçoit les messages de src/core/diag.ts (téléphone en cours d'essai) et les écrit dans e2e/out/device.log. */
const deviceLog = (): Plugin => ({
  name: 'hr-device-log',
  configureServer(server) {
    server.middlewares.use('/__hr_log', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          mkdirSync('e2e/out', { recursive: true });
          appendFileSync('e2e/out/device.log', `${new Date().toISOString()} ${req.socket.remoteAddress} ${body}\n`);
        } catch { /* sans importance */ }
        res.statusCode = 204;
        res.end();
      });
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [deviceLog()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
