import { rmSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nitro's static prerender can serve an existing index.html before rendering
 * the new client bundle. Remove only generated output before every build. */
export function cleanBuildOutput(projectRoot) {
  rmSync(resolve(projectRoot, '.output'), { recursive: true, force: true });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cleanBuildOutput(dirname(dirname(fileURLToPath(import.meta.url))));
}
