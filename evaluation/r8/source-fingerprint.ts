import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
export const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
/** Hash bytes only: no evaluation answers or holdout text are loaded into a model prompt. */
export function sourceFingerprint() {
  const roots = ["src", "server", "scripts", "evaluation"];
  const paths = roots.flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && /\.(?:[cm]?js|tsx?|json)$/.test(e.name) && !/\/results(?:\/|$)/.test(e.parentPath))
    .map(e => `${e.parentPath}/${e.name}`));
  paths.push("package.json", "package-lock.json", "tsconfig.json", "vite.config.ts");
  const files = paths.sort().map(path => ({ path, sha256: sha(readFileSync(path)) }));
  return { version: "V4-C15-R8-closeout", sha256: sha(JSON.stringify(files)), files };
}
