import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { grokPwaPlugin } from "./grok-pwa-plugin.mjs";

/** Nitro's separate prerender bundle does not inherit Vite's raw/virtual loaders. */
export function nitroPwaBundle() {
  const branding = grokPwaPlugin();
  return {
    name: "fangkun:nitro-pwa-assets",
    resolveId(id, importer) {
      const virtual = branding.resolveId(id);
      if (virtual) return virtual;
      if (id.endsWith(".html?raw") && (isAbsolute(id) || importer)) return resolve(importer ? dirname(importer) : process.cwd(), id);
      return null;
    },
    load(id) {
      if (id.endsWith(".html?raw")) return `export default ${JSON.stringify(readFileSync(id.slice(0, -4), "utf8"))};`;
      return branding.load(id);
    },
  };
}

/** Locked Nitro beta still asks Vite to bundle an HTML entry after a static prerender.
 * Static presets intentionally have no runtime server bundle. Keep all real builds/errors.
 * https://nitro.build/docs/prerendering#static-hosting
 */
export function staticNitroBuildCompat(publicDir = resolve(".output/public")) {
  return {
    name: "fangkun:nitro-static-build",
    apply: "build",
    buildApp: {
      order: "pre",
      handler(builder) {
        const build = builder.build.bind(builder);
        builder.build = async environment => {
          const input = environment.config.build.rolldownOptions?.input ?? environment.config.build.rollupOptions?.input;
          const inputs = typeof input === "string" ? [input] : Array.isArray(input) ? input : Object.values(input || {});
          const missingServerEntry = !inputs.length || inputs.every(value => typeof value === "string" && value.endsWith(".html"));
          if (environment.name === "nitro" && missingServerEntry) {
            if (!existsSync(resolve(publicDir, "index.html"))) throw new Error("Static prerender has not produced index.html");
            environment.isBuilt = true;
            return { output: [] };
          }
          return build(environment);
        };
      },
    },
  };
}
