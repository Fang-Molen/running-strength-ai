import { register } from 'node:module'
register('./test-loader.mjs', import.meta.url)
// v89.6：应用不再内置个人计划。测试用私有夹具（test-fixtures/private，不进构建/精简包）模拟“已导入计划”的设备；
// 设 FK_NO_TEST_PLAN=1 可模拟全新设备。
import { readFileSync, existsSync } from 'node:fs'
{
  const f = new URL('../test-fixtures/private/plan400-v4.json', import.meta.url)
  if (!process.env.FK_NO_TEST_PLAN && existsSync(f)) globalThis.__FK_TEST_PLAN_DOC__ = { schema: 'fangkun-plan-v1', tag: 'V4', label: '400米 V4', plan: JSON.parse(readFileSync(f, 'utf8')) }
}
