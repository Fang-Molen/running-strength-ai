import test from 'node:test'
import assert from 'node:assert/strict'
import {parseQuickLog} from './quick-log'
import {quickDraftInput} from './quick-log-save'
const run=(s:string)=>{const p=parseQuickLog(s,'2026-10-28');assert.equal(p.kind,'run');if(p.kind!=='run')throw Error(s);return p}
const lift=(s:string)=>{const p=parseQuickLog(s,'2026-10-28');assert.equal(p.kind,'strength');if(p.kind!=='strength')throw Error(s);return p}
test('weight before or after sets stays the same reported kg, without contaminating exercise',()=>{
 for(const s of ['深蹲40公斤3组8次','深蹲3×8 40kg']){const p=lift(s);assert.equal(p.name,'深蹲');assert.equal(p.kg,40);assert.equal(p.sets,3);assert.equal(p.reps,8)}
 assert.equal(lift('卧推3×8').kg,null)
 for(const [s,basis,kg] of [['哑铃卧推单手20公斤3组8次','单手',20],['哑铃卧推总重40公斤3组8次','总重',40],['深蹲自重3组8次','自重',null]] as const){const p=lift(s);assert.equal(p.weightBasis,basis);assert.equal(p.kg,kg);const d=quickDraftInput(p,'2026-10-20T02:00:00Z',null);assert.match(d.warnings.join(' '),new RegExp(basis));}
 assert.equal(parseQuickLog('深蹲40磅3组8次').kind,'unknown')
})
test('minutes and seconds stay exact; average pace is not session duration',()=>{
 const p=run('跑6.01公里26分52秒');assert.equal(p.km,6.01);assert.equal(Math.round(p.minutes!*60),1612);assert.equal(p.pace,'4:28')
 assert.equal(quickDraftInput(p,'2026-10-20T02:00:00Z',null).durationSeconds.value,1612)
 for(const s of ['跑6.01公里均速4分28','跑6.01公里配速4:28']){const p=run(s);assert.equal(p.minutes,null);assert.equal(p.pace,'4:28')}
 assert.equal(run('跑6.01公里26分52秒均速4分28').minutes,p.minutes)
 assert.equal(parseQuickLog('跑6公里26分82秒').kind,'unknown')
})
test('historical dates survive into saved fact; impossible and vague dates stay unknown',()=>{
 for(const [s,date] of [['2026-10-20 跑6公里27分钟','2026-10-20'],['去年10月20日 跑6公里27分钟','2025-10-20'],['昨天跑6公里27分钟','2026-10-27']] as const){const p=run(s);assert.equal(p.date,date);const at=quickDraftInput(p,'2026-10-28T02:00:00Z',null).occurredAt.value!;const d=new Date(at);assert.equal(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,date)}
 for(const s of ['2026-02-30跑6公里','上周跑6公里','2027-01-01跑6公里'])assert.equal(parseQuickLog(s,'2026-10-28').kind,'unknown')
 assert.equal(parseQuickLog('昨天体重65公斤','2026-10-28').date,'2026-10-27')
})
test('negation, third person, plans, multiple workouts and multiple meals cannot create a personal training',()=>{
 for(const s of ['我没有跑6公里','他跑6公里27分钟','我朋友深蹲40公斤3组8次','明天跑6公里','计划跑6公里','跑5公里，后来又跑3公里','早餐牛奶250g；午餐米饭200g'])assert.equal(parseQuickLog(s,'2026-10-28').kind,'unknown',s)
 assert.equal(run('我跑6公里27分钟').km,6)
})
