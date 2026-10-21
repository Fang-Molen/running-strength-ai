import { rmSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nitro's static prerender can reuse generated HTML and a cached server manifest.
 * Remove both generated output and Nitro build caches before every build. */
export function cleanBuildOutput(projectRoot) {
  for (const generated of ['.output', '.nitro', 'node_modules/.nitro']) {
    rmSync(resolve(projectRoot, generated), { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cleanBuildOutput(dirname(dirname(fileURLToPath(import.meta.url))));
}
