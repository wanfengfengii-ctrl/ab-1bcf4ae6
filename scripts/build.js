import { build } from 'esbuild';
import { mkdir, copyFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist), { recursive: true });

await build({
  entryPoints: [path.join(root, 'web', 'app.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  outfile: path.join(dist, 'app.js'),
});

for (const f of ['index.html', 'styles.css']) {
  if (await exists(path.join(root, 'web', f))) {
    await copyFile(path.join(root, 'web', f), path.join(dist, f));
  }
}

console.log('[build] 前端产物已输出到 dist/');
