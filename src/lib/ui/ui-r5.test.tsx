/* R5 UI polish: source invariants + render checks (no browser). Playwright flows live in the R5 audit package. */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { CoachAnswerView } from "../../components/coach-answer-view.tsx"
const src = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8")

test("runner: double-tap guard is released after every committed set change (last set → 结束并保存训练 works)", () => {
  const s = src("src/components/training-runner.tsx")
  const m = /useEffect\(\(\) => \{\s*saving\.current = false\s*\}, \[([^\]]*)\]\)/.exec(s)
  assert.ok(m, "guard reset effect exists")
  for (const dep of ["cursor", "phase", "sets"]) assert.ok(m![1].split(",").map(x => x.trim()).includes(dep), `guard reset depends on ${dep}`)
  assert.match(s, /function finishSaved[\s\S]{0,240}if \(saving\.current\) return/, "finishSaved keeps its double-tap guard")
})
test("hydration (#418): index route renders StrengthApp client-only behind a static fallback", () => {
  const s = src("src/routes/index.tsx")
  assert.match(s, /<ClientOnly fallback=\{[\s\S]*data-ready="false"[\s\S]*\}><StrengthApp \/><\/ClientOnly>/)
})
test("3D detail: no one-off reds, overlays read the brand-orange token", () => {
  for (const f of ["src/components/exercise-demo.css", "src/components/muscle-target-card.css", "public/demo3d/anatomy3d.js", "public/demo3d/viewer3d.js", "src/lib/strength/demo/musclemap.js", "src/lib/strength/demo/renderer.js"]) {
    const s = src(f).replace(/\/\/.*$/gm, "")
    for (const red of ["#e8202a", "#ff4a4a", "#ff5a3c", "#f17650", "#ed7655", "#ec7956", "#542d25", "#ffa18b", "rgba(255,90,60"]) assert.ok(!s.toLowerCase().includes(red), `${f} still has ${red}`)
  }
  assert.match(src("src/styles.css"), /--fk-brand-orange:\s*#ff6a1a/)
  assert.match(src("src/styles.css"), /--fk-accent:\s*var\(--fk-brand-orange\)/)
  assert.match(src("src/components/exercise-demo.css"), /--p:var\(--fk-brand-orange/)
  assert.match(src("public/demo3d/anatomy3d.js"), /fkToken\('--fk-brand-orange'/)
})
test("settings sheet: sticky, opaque header carries the safe-area padding and the close button", () => {
  const s = src("src/components/strength-app.tsx")
  assert.match(s, /data-testid="settings-header" className="sticky top-0[^"]* bg-bg[ "][^"]*"[^>]*paddingTop: "max\(6px, env\(safe-area-inset-top\)\)"/)
})
test("方坤 answer: conclusion first, next session, reasoning collapsed; every sentence still in the DOM", () => {
  const text = "先看事实：上次 400米×8 平均 82 秒。\n结论：这次是有氧耐力课，不是速度课。\n原因是休息 1 分钟。\n下一课：400米×6，休 2 分钟。"
  const html = renderToString(<CoachAnswerView text={text} />)
  const i = (k: string) => html.indexOf(k)
  assert.ok(i('data-testid="coach-conclusion"') < i('data-testid="coach-next"') && i('data-testid="coach-next"') < i('data-testid="coach-reasoning"'))
  assert.ok(!/<details[^>]*open/.test(html), "reasoning collapsed by default")
  for (const s of ["这次是有氧耐力课，不是速度课。", "下一课：400米×6，休 2 分钟。", "先看事实：上次 400米×8 平均 82 秒。", "原因是休息 1 分钟。"]) assert.ok(html.includes(s), s)
  assert.match(src("src/components/coach-sheet.tsx"), /<CoachAnswerView text=\{message\.text\.split\('\\n依据：'\)\[0\]\}\/>/)
})
test("manual splits: 按目标填充 is wired into both running-record forms and writes the existing reps field", () => {
  const s = src("src/components/plan400.tsx")
  assert.equal((s.match(/<SplitGrid d=\{d\} value=\{edit\.reps\}/g) || []).length, 2)
  assert.match(s, /data-testid="split-fill-target"/)
})
