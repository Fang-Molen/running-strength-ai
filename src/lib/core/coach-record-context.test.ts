import test from "node:test"
import assert from "node:assert/strict"
import { answerFromRecordedContext } from "./coach-record-context.ts"
import type { CoachBrief } from "./coach-brief.ts"
const make = (patch: Record<string, unknown> = {}) => ({question:"今天吃了多少热量", occurrenceId:"s1", sourceIds:["nutrition:log:2026-10-10","context:fuel-target:2026-10-10"],fuel:{todayDay:"2026-10-10",trainingDay:"2026-10-10",status:"SAME_DAY_RECORDED",entries:[{id:"f1",kcal:600}],recordedKcal:600,targetKcal:2500,logSourceId:"nutrition:log:2026-10-10",targetSourceId:"context:fuel-target:2026-10-10"},...patch}) as unknown as CoachBrief
test("recorded food is not interpreted as whole-day intake",()=>{const s=answerFromRecordedContext(make())!;assert.match(s,/600 千卡/);assert.match(s,/不能认定为全天实际摄入/);assert.match(s,/目标，不是实际摄入/)})
test("missing food does not imply fasting",()=>{const s=answerFromRecordedContext(make({fuel:{status:"NO_RECORD",todayDay:"2026-10-10",trainingDay:"2026-10-10",entries:[],recordedKcal:null,targetKcal:null,logSourceId:null,targetSourceId:null}}))!;assert.match(s,/不等于当天没有进食/)})
test("cross-day food not attributed to old workout",()=>{const s=answerFromRecordedContext(make({fuel:{status:"DIFFERENT_DAY",todayDay:"2026-10-10",trainingDay:"2026-10-09",entries:[],recordedKcal:null,targetKcal:null,logSourceId:null,targetSourceId:null}}))!;assert.match(s,/不能将今天饮食记录归属/)})
test("missing provenance hides numeric claim",()=>{const s=answerFromRecordedContext(make({sourceIds:[]}))!;assert.doesNotMatch(s,/600 千卡/);assert.match(s,/来源未核验/)})
test("training facts only when recorded",()=>{const s=answerFromRecordedContext(make({question:"上次训练完成多少",sessionRpe:8,plannedSetCount:5,completedSetCount:4}))!;assert.match(s,/RPE 8/);assert.match(s,/4\/5/);assert.doesNotMatch(s,/疲劳已确认/)})
test("no occurrence means no guessed training",()=>{const s=answerFromRecordedContext(make({question:"最近训练记录",occurrenceId:null}))!;assert.match(s,/不会按日期猜测/)})
test("unrelated question stays on existing coach path",()=>{assert.equal(answerFromRecordedContext(make({question:"你好"})),null)})
