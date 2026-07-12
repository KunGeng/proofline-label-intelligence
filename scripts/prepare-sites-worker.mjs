import { copyFile, mkdir, readdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'worker/static-site.js');
const dist = resolve(root, 'dist');
const client = resolve(dist, 'client');
const target = resolve(dist, 'server/index.js');

await mkdir(client, { recursive: true });

for (const entry of await readdir(dist)) {
  if (entry === 'client' || entry === 'server') {
    continue;
  }

  await rename(resolve(dist, entry), resolve(client, entry));
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
