import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, test } from "node:test"
import { CATALOG } from "./catalog.ts"
import { addEntry, loadEntries, todayEaten } from "./log.ts"
import { catalogSize, parseFoodLine, searchFoods } from "./lookup.ts"

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  const store = {
    keys:()=>[...memory.keys()], getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size
    },
  }
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  Object.defineProperty(globalThis, "window", { value: { localStorage: store }, configurable: true })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(name) && name !== "catalog-usda.ts" && name !== "catalog.test.ts") out.push(path)
  }
  return out
}

test("old foods stay findable and the new list only adds names", () => {
  const oldNames = new Set(CATALOG.flatMap((food) => food.names))
  assert.equal(oldNames.has("蛋白粉"), true)
  assert.ok(catalogSize() > oldNames.size)
  assert.ok(catalogSize() >= 5000)
  const rice = parseFoodLine("米饭")
  assert.equal(rice.length > 0, true)
  assert.equal(rice[0]?.name.includes("米饭"), true)
  const alias = searchFoods("鶏むね")
  assert.equal(alias.length > 0, true)
  assert.equal(alias.some((hit) => hit.kcal === 165), true)
})

test("a logged food keeps calories and protein after reload", () => {
  addEntry({ meal: "午餐", name: "米饭", grams: 200, kcal: 232, protein: 4.2, label: "200克" })
  assert.equal(todayEaten(), 232)
  assert.equal(loadEntries()[0]?.protein, 4.2)
  assert.equal(loadEntries()[0]?.meal, "午餐")
  assert.equal(loadEntries()[0]?.name, "米饭")
})

test("brand-specific workout export is gone and device copy remains", () => {
  // Paper titles and measurement limitations retain the actual studied device.
  // Only these historical research data files are exempt; product code and
  // execution/export helpers still must be free of brand-specific workflows.
  const citationData = new Set([
    "src/lib/core/research-r4-r7-data.ts",
    "src/lib/core/research-r4-r7-data.json",
    "src/lib/core/research-evidence-r4-r7.ts",
  ].map(path => join(process.cwd(), path)))
  const files = walk(join(process.cwd(), "src")).filter(path => !/\.test\.[cm]?[jt]sx?$/.test(path))
  const source = files.filter(path => !citationData.has(path)).map(path => readFileSync(path, "utf8")).join("\n")
  const citations = files.filter(path => citationData.has(path)).map(path => readFileSync(path, "utf8")).join("\n")
  assert.match(citations, /Garmin Vivosmart 4/)
  assert.doesNotMatch(citations, /export\s+(?:async\s+)?function\s+(?:exportGarmin|writeGarmin(?!DailyProgress\b)|createGarmin)/i)
  // DailyProgress writes a local import receipt, not a device workout export.
  assert.doesNotMatch(source, /export\s+(?:async\s+)?function\s+(?:exportGarmin|writeGarmin(?!DailyProgress\b)|createGarmin)/i) // v74 explicitly includes read-only device imports; do not forbid their type names.
  assert.equal(source.includes("尚未记录设备总消耗"), true)
  assert.equal(source.includes("手表总消耗"), true)
})
