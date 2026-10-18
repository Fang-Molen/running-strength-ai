import {evaluateCoachEvolution} from '../../src/lib/core/coach-evolution-v4.ts'
import {writeFileSync} from 'node:fs'
const at=(d,h=9)=>`2026-10-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00Z`
const evidence=(id,metric,value,d,extra={})=>({id,athleteId:'synthetic-800',occurrenceId:'occ-1',metric,value,
 unit:metric==='SPLIT_SECONDS'?'s':metric==='SLEEP_HOURS'?'h':'score',context:'600m x2 / synthetic track',eventAt:at(d),recordedAt:at(d,10),
 source:'USER_REPORT',sourceId:`user:${id}`,confirmation:'USER_REPORTED',...extra})
const rows=[evidence('rep1','SPLIT_SECONDS',85,1),evidence('rep2','SPLIT_SECONDS',91,1)]
const cases=[
 {day:1,question:'600米第二组掉速，是不是专项能力不足？'},
 {day:2,question:'昨晚只睡了5小时，重新判断。',add:[evidence('sleep','SLEEP_HOURS',5,2)]},
 {day:3,question:'第二组原来记错了，实际88秒。',add:[evidence('rep2-fix','SPLIT_SECONDS',88,1,{recordedAt:at(3,10),supersedes:'rep2'})]},
 {day:4,question:'又有一次600米训练，感觉后程慢了。',add:[evidence('repeat','SPLIT_SECONDS',90,4,{occurrenceId:'occ-2'})]},
 {day:5,question:'跟腱疼痛3/10，明天能不能再加高强度？',add:[evidence('pain','PAIN_SCORE',3,5)]},
 {day:6,question:'请结合一周反馈复盘。',add:[evidence('future','SPLIT_SECONDS',75,7,{occurrenceId:'occ-3'})]},
]
let prior;const output=[]
for(const c of cases){rows.push(...(c.add??[]));const s=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(c.day,11),question:c.question,evidence:rows,prior});
 output.push({turn:c.day,question:c.question,asOf:s.asOf,activeFacts:s.active.map(e=>({id:e.id,metric:e.metric,value:e.value,source:e.source,confirmation:e.confirmation})),
 excluded:s.excluded,corrections:s.corrections,revision:s.revision,missing:s.missing,safety:s.safety,nextAction:s.nextAction,
 hypotheses:s.hypotheses.map(h=>({id:h.id,supports:h.supports,challenges:h.challenges,question:h.discriminatingQuestion})),
 decisionAuthorized:s.trainingDecisionAuthorized});prior=s}
writeFileSync(new URL('./six-turn-deterministic-replay.json',import.meta.url),JSON.stringify(output,null,2)+'\n')
console.log('six turns replayed, latest safety:',output.at(-1).safety,'future excluded:',output.at(-1).excluded.some(e=>e.id==='future'))
