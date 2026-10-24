/** Test-only opt-in. Never imported by application entrypoints. */
import plan from './plan400-v4.json' with {type:'json'}
if(!process.env.FK_NO_TEST_PLAN)(globalThis as typeof globalThis & {__FK_TEST_PLAN_DOC__?:unknown}).__FK_TEST_PLAN_DOC__={schema:'fangkun-plan-v1',tag:'V4',label:'公开合成测试计划',plan}
