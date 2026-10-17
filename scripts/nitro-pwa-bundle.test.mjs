import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nitroPwaBundle, staticNitroBuildCompat } from "./nitro-pwa-bundle.mjs";

test("Nitro receives the unchanged install tutorial as a bundled string", () => {
  const plugin = nitroPwaBundle();
  const importer = fileURLToPath(new URL("../server/middleware/grok-pwa.ts", import.meta.url));
  const id = plugin.resolveId("../../scripts/install-page.html?raw", importer);
  assert.equal(id, fileURLToPath(new URL("./install-page.html", import.meta.url)) + "?raw");
  assert.equal(JSON.parse(plugin.load(id).slice("export default ".length, -1)), readFileSync(new URL("./install-page.html", import.meta.url), "utf8"));
});
test("Nitro retains platform branding identity while leaving ordinary modules alone", () => {
  const plugin = nitroPwaBundle();
  const id = plugin.resolveId("virtual:grok-og-identity");
  assert.ok(id); assert.match(plugin.load(id), /export const grokOgIdentity =/);
  assert.equal(plugin.resolveId("react", "/app/entry.ts"), null);
});

test("static compatibility skips only a missing Nitro server entry after successful prerender", async () => {
  const root = mkdtempSync(join(tmpdir(), "fk-static-"));
  try {
    const built = [];
    const builder = { build: async env => { built.push(env.name); return { output: [env.name] }; } };
    staticNitroBuildCompat(root).buildApp.handler(builder);
    const env = (name, input) => ({ name, config: { build: { rolldownOptions: { input } } } });
    await assert.rejects(() => builder.build(env("nitro", undefined)), /has not produced/);
    writeFileSync(join(root, "index.html"), "<!doctype html><main>rendered</main>");
    assert.deepEqual(await builder.build(env("nitro", undefined)), { output: [] });
    assert.deepEqual(await builder.build(env("client", "index.html")), { output: ["client"] });
    assert.deepEqual(await builder.build(env("nitro", "server.ts")), { output: ["nitro"] });
    assert.deepEqual(built, ["client", "nitro"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
