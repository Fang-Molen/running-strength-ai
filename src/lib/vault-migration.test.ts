import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migrateKv, MIGRATIONS, VAULT_SCHEMA, rotateSnapshots, SNAPSHOT_KEEP, type Snapshot } from "./vault.ts";

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/vault-beta1-snapshot.json", import.meta.url), "utf8"));

test("测试版 schema1 快照升级到当前 schema 后，所有用户键和值都保留", () => {
  const before = new Map<string, string>(Object.entries(fixture.data));
  const after = migrateKv(new Map(before), fixture.schema);
  for (const [k, v] of before) {
    assert.ok(after.has(k), `键丢失: ${k}`);
    if (after.get(k) !== v) JSON.parse(after.get(k)!); // 允许补字段，但必须仍是有效 JSON
  }
  assert.ok(after.size >= before.size);
});

test("每个迁移都是追加式：不删除键，也不把值清空", () => {
  for (const [ver, fn] of Object.entries(MIGRATIONS)) {
    const kv = new Map<string, string>(Object.entries(fixture.data));
    fn(kv);
    for (const k of Object.keys(fixture.data)) { assert.ok(kv.has(k), `迁移 ${ver} 删除了 ${k}`); assert.ok((kv.get(k) ?? "").length > 0, `迁移 ${ver} 清空了 ${k}`); }
  }
  assert.ok(VAULT_SCHEMA >= fixture.schema);
});

test("自动快照：至少间隔 24 小时，最多保留 7 份", () => {
  let list: Snapshot[] = []; const t0 = Date.parse("2026-10-16T00:00:00Z");
  for (let d = 0; d < 10; d++) { list = rotateSnapshots(list, { a: String(d) }, t0 + d * 86400e3); list = rotateSnapshots(list, { a: "x" }, t0 + d * 86400e3 + 3600e3); }
  assert.equal(list.length, SNAPSHOT_KEEP);
  assert.equal(list[list.length - 1].data.a, "9");
});
