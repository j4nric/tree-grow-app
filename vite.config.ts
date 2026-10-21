import { defineConfig, type Plugin } from 'vitest/config';
import { contentVersion, precacheList, serviceWorkerSource } from './src/pwa/service-worker.ts';

/**
 * Schreibt nach dem Bauen dist/sw.js: Liste aller gebauten Dateien (gehashte Assets,
 * index.html, Manifest, Icons) und eine Version aus ihren Inhalten – jede Änderung ergibt
 * einen neuen Cache und damit den Hinweis „Neue Version verfügbar“. Nur beim Bauen.
 */
function serviceWorker(): Plugin {
  return {
    name: 'vszw-service-worker',
    apply: 'build',
    async writeBundle(options) {
      const dir = options.dir;
      if (!dir) return;
      const files: { path: string; data: Uint8Array }[] = [];
      const walk = async (rel: string): Promise<void> => {
        for (const entry of await this.fs.readdir(`${dir}/${rel}`, { withFileTypes: true })) {
          const path = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(path);
          else files.push({ path, data: await this.fs.readFile(`${dir}/${path}`) });
        }
      };
      await walk('');
      const list = precacheList(files.map((f) => f.path));
      const version = contentVersion(files.filter((f) => f.path !== 'sw.js'));
      await this.fs.writeFile(`${dir}/sw.js`, serviceWorkerSource({ version, files: list, networkTimeoutMs: 4000 }));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  test: {
    include: ['tests/**/*.test.ts', 'server/tests/**/*.test.ts'],
  },
});
