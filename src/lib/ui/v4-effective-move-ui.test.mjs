// @ts-nocheck — R1 候选测试原样保留（JS 夹具未标类型）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const root = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const plan = read('components/plan400.tsx'), board = read('components/today-board.tsx'), parts=read('components/plan400-parts.tsx')
test('ensure V4 entry does not recreate a moved original date',()=>assert.match(plan,/old && old\.date !== date/))
test('original V4 day displays moved history',()=>assert.match(plan,/data-testid="v4-moved-history"/))
test('original V4 day does not expose main start CTA after move',()=>assert.match(plan,/moved \? <div[^>]*data-testid="today-moved-status"/))
test('original V4 date suppresses new after/during feedback after move',()=>{assert.match(plan,/tab === "after" && !moved/);assert.match(plan,/tab === "during" && !moved/);assert.match(plan,/tab === "later" && !moved/)})
test('moved V4 entry shows on target day even if target has its own V4 plan',()=>assert.match(board,/e\.id === `plan400:\$\{e\.date\}:strength`/))
test('advanced feedback is collapsible, core RPE remains',()=>{assert.match(parts,/更多反馈（感受、备注，可选）/);assert.match(parts,/RPE（1–10/);assert.match(parts,/saveComponent\(date, part/)})
const pending=read('lib/ui/pending-feedback.ts')
test('pending feedback ignores moved original date without actual',()=>{assert.match(pending,/movedOriginalDates\.has\(d\.date\) && !f\.actualRun && !f\.actualLift/);assert.match(parts,/fk-schedule-changed/);assert.match(parts,/movedDates/);})
