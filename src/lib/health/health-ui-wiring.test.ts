/** Static integration guards supplement behavioral data tests; these are NOT browser tests. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=(file:string)=>readFileSync(new URL('../../'+file,import.meta.url),'utf8')
for(const file of ['components/health-page-v89.tsx','components/intraday-panel.tsx','components/body-center.tsx','components/fangkun-ui/health-dashboard.tsx'])test(`${file} subscribes to shared provider/scope/foreground invalidation`,()=>{assert.match(read(file),/subscribeHealthUpdates\(/)})
test('main battery tile and trend heading use the common current-value selector',()=>{const s=read('components/health-page-v89.tsx');assert.ok((s.match(/resolveBodyBattery\(/g)||[]).length>=3);assert.match(s,/SyncNote rev=\{rev\}/);assert.doesNotMatch(s,/setPick\(null\), \[d\.day, k\]/)})
test('secondary health tiles use the same snapshot as main health and coach',()=>{assert.match(read('components/health-tiles.tsx'),/loadHealthSnapshot\(today\)/)})
test('global coach snapshot fingerprint includes both provider cache types',()=>{const s=read('lib/coach/global-coach-host-v89.ts');assert.match(s,/coros-mcp-health/);assert.match(s,/garmin-intraday/)})
test('global coach health evidence resolves the same current battery as the tile',()=>{assert.match(read('lib/coach/global-coach-host-v89.ts'),/resolveBodyBattery\(/)})
test('auxiliary health tiles subscribe directly and use the common battery selector',()=>{const s=read('components/health-tiles.tsx');assert.match(s,/subscribeHealthUpdates\(/);assert.match(s,/resolveBodyBattery\(/)})
test('auto fallback date can follow fresh today data without overriding manual history',()=>{const s=read('components/health-page-v89.tsx');assert.match(s,/reconcileHealthDay\(/);assert.match(s,/historyPinned/);assert.match(s,/intradayMatchesSource\(/)})
