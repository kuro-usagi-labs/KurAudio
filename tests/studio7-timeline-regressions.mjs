import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

// Freeze browser modules during concurrent source work. Each child still runs
// the existing real-browser suite in its own clean Chromium context.
const folder = path.resolve('test-results/studio7/timeline/regressions'); await fs.mkdir(folder, { recursive: true });
const server = await createServer({ cacheDir: 'node_modules/.vite-studio7-timeline-regressions', optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 1438, strictPort: true, hmr: false }, clearScreen: false }); await server.listen();
try {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['clip-actions', 'trim-interaction', 'timeline-scroll', 'track-workflow']) {
    const source = await fs.readFile(`tests/${name}.mjs`, 'utf8');
    const script = path.join(folder, `${name}.mjs`);
    await fs.writeFile(script, source.replaceAll('http://127.0.0.1:1422', 'http://127.0.0.1:1438').replaceAll('test-results/comfort/timeline', 'test-results/studio7/timeline/regressions/clip-actions').replaceAll('test-results/trim-interaction', 'test-results/studio7/timeline/regressions/trim').replaceAll('test-results/timeline-scroll', 'test-results/studio7/timeline/regressions/scroll').replaceAll('test-results/track-workflow', 'test-results/studio7/timeline/regressions/drop'));
    const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, [script], { stdio: 'inherit', windowsHide: true }); child.on('error', reject); child.on('close', resolve); });
    if (code) { process.exitCode = 1; break; }
  }
} finally { await server.close(); }
