import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { saveCoach, type CoachMemory } from "./coach.ts"
import { savePlan, type Plan } from "./model.ts"

function install(box: Map<string, string>, failOn?: (key: string, value: string) => boolean) {
  const storage = {
    keys:()=>[...box.keys()], getItem: (key: string) => box.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failOn?.(key, value)) throw new Error("quota")
      box.set(key, value)
    },
    removeItem: (key: string) => { box.delete(key) },
    clear: () => box.clear(),
    key: (index: number) => [...box.keys()][index] ?? null,
    get length() { return box.size },
  }
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
}

test("plan and coach saves report quota failure and leave the old value", () => {
  const box = new Map<string, string>()
  install(box)
  const plan = { name: "保留课表", kind: "custom", sessions: [] } as unknown as Plan
  assert.equal(savePlan(plan), true)
  install(box, (key, value) => key === "fr255-strength-plan-v3" && value.includes("新课表"))
  assert.equal(savePlan({ ...plan, name: "新课表" } as Plan), false)
  assert.match(box.get("fr255-strength-plan-v3") ?? "", /保留课表/)
  const memory = { fatigue: 20, band: "ok", goals: [], notes: [], messages: [], minutes: 40 } as unknown as CoachMemory
  install(box)
  assert.equal(saveCoach(memory), true)
  install(box, (key) => key === "fr255-coach-v2")
  assert.equal(saveCoach({ ...memory, minutes: 50 } as CoachMemory), false)
  assert.match(box.get("fr255-coach-v2") ?? "", /"minutes":40/)
})

test("offline shell does not cache model calls and expires old shell caches", () => {
  const source = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8")
  assert.match(source, /request\.method !== "GET"/)
  assert.match(source, /\/_server/)
  assert.match(source, /fr255-shell-/)
  assert.doesNotMatch(source, /cache\.addAll/)
  assert.match(source, /updateViaCache|networkFirst|fromNetwork/)
})
