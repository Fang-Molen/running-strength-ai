import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {calculateSessionLoad,parseReportedRpes,formatSessionLoad,statedSessionMinutes} from './coach-session-load.ts'
for(const [i,line] of readFileSync(new URL('./__fixtures__/session-load.jsonl',import.meta.url),'utf8').trim().split('\n').entries())test(`R11 session load ${i}`,()=>{
 const r=JSON.parse(line),result=calculateSessionLoad(r.text,r.rpe??null,r.seconds??null,r.continuousSeconds??null)
 assert.equal(result.status,r.expectStatus);assert.equal(result.au,r.expectAU)
 if(result.status==='CALCULATED'){const text=formatSessionLoad(result);assert.match(text,/整课RPE .* × .* 分钟 = .* AU/);assert.match(text,/同口径/)}
})
test('R11 all RPE scopes remain separate; unqualified rating cannot conflict',()=>{
 const readings=parseReportedRpes('整课RPE 6，最后一组我觉得RPE 9，单段RPE 8，RPE 7')
 assert.deepEqual(readings.map(r=>r.scope),['SESSION_RPE','SET_RPE','SEGMENT_RPE','UNSPECIFIED'])
 assert.equal(calculateSessionLoad('末组RPE 9，RPE 8',6,3000).au,300)
})
test('unavailable HRV/RHR cannot erase stated minutes or promote an unspecified RPE',()=>{
 for(const missing of ['没有HRV数据','HRV没有','没有静息心率记录','RHR未知']){
  const q=`50分钟，RPE7，算下负荷，${missing}`
  assert.equal(statedSessionMinutes(q),50)
  assert.equal(calculateSessionLoad(q).au,null,'RPE scope still requires confirmation')
  assert.equal(calculateSessionLoad(`50分钟，整课RPE7，${missing}`).au,350)
 }
})
test('missing device measurements do not authorize planned, negated or partial duration',()=>{
 for(const q of ['计划50分钟，RPE7，没有HRV数据','50分钟，RPE7，没有完成','50分钟，RPE7，只是单段，没有HRV数据'])
  assert.equal(statedSessionMinutes(q),null)
})
