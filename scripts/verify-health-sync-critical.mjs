/** Narrow, offline release checks. Does not run npm test, call a model, sync a
 * real account, clear browser storage, migrate a database or deploy anything. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('../', import.meta.url))
try { createRequire(import.meta.url).resolve('typescript') }
catch { console.error('缺少项目依赖。请在原工程按 package-lock.json 安装依赖后再运行；不要降级依赖或清空用户记录。'); process.exit(2) }
const tests = [
  'health-current', 'health-release-regression', 'health-view-state',
  'health-subscription', 'health-ui-wiring', 'health-live-regression',
  'intraday-recovery-bridge-v89', 'event-presentation', 'reviewed-correction',
  'cloud-parse', 'native-health',
].map(name => `src/lib/health/${name}.test.ts`)
const result = spawnSync(process.execPath, ['--import','./scripts/test-register.mjs','--test','--test-concurrency=2',...tests], {
  cwd: root, stdio: 'inherit', env: {...process.env, FK_NO_TEST_PLAN: '1'}, timeout: 120_000,
})
if (result.error) console.error('关键检查未完成：', result.error.message)
process.exit(result.status ?? 1)
