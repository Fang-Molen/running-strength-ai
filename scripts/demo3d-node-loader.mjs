// Resolve the existing vendored browser module graph for CPU-only asset checks.
// This does not launch a browser or emulate WebGL.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const publicRoot = resolve(import.meta.dirname, '../public');
export async function resolveModule(specifier, context, nextResolve) {
  if (specifier.startsWith('/demo3d/')) return { url: pathToFileURL(resolve(publicRoot, specifier.slice(1))).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
export { resolveModule as resolve };
