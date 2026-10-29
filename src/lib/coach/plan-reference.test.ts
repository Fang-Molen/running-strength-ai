import test from 'node:test'
import assert from 'node:assert/strict'
import {validateCoachAssertions} from './assertion-policy'
const question='原计划这周有五次训练，这周工作忙只能训练三次，请先分析，不改日历。'
const citedQuotes=['原计划这周有五次训练','这周工作忙只能训练三次']
const options={question,citedQuotes,factQuotes:citedQuotes,safetyRestricted:false}
test('sourced planned and available counts can be referenced in conditional advice',()=>{
 assert.equal(validateCoachAssertions('这五次原计划的性质需要核对，不把五次压缩成三次，优先保留三次。',options).ok,true)
 assert.equal(validateCoachAssertions('可以从原计划五次中优先保留三次，具体保留哪些关键课需核对内容，不把其余训练叠加。',options).ok,true)
})
test('counts are dimensioned and role bound, not a whitelist of digits',()=>{
 for(const text of ['本周保留五次训练。','本周只保留两次训练。','你已完成三次训练。','你已练过三次。','明天跑三公里。','保留三次并额外做三组。','把五次训练压成三次。'])assert.equal(validateCoachAssertions(text,options).ok,false,text)
 assert.equal(validateCoachAssertions('本周可练三次。',{...options,citedQuotes:['原计划这周有五次训练']}).ok,false)
})
test('valid plan references do not waive injury clearance or unauthorized writes',()=>{
 assert.equal(validateCoachAssertions('你可以继续跑步，保留三次训练。',{...options,question:question+'我腿疼，走路困难',safetyRestricted:true}).ok,false)
 assert.equal(validateCoachAssertions('保留三次训练。',{...options,safetyRestricted:true}).ok,false)
 assert.equal(validateCoachAssertions('已经替你修改课表，保留三次训练。',options).ok,false)
})
import {asksLoadSummary} from './online-load-context'
test('recorded-distance questions use the same canonical aggregate path as explicit load summaries',()=>{
 assert.equal(asksLoadSummary('2025年我已记录了多少公里？数据能证明全年每次训练都记录齐了吗？'),true)
 assert.equal(asksLoadSummary('10月25日至29日我已记录了多少公里？'),true)
 assert.equal(asksLoadSummary('一般配速是什么？'),false)
})
import {supportedEvidenceQuote} from './question-evidence'
test('quotes may select complete exact source fields, never altered values or cut negations',()=>{
 const s='范围2025年，已记录183课，已知距离915公里；覆盖未确认；未经核验。'
 assert.equal(supportedEvidenceQuote(s,'范围2025年，已记录183课，已知距离915公里'),true)
 assert.equal(supportedEvidenceQuote(s,'已知距离915公里'),true)
 assert.equal(supportedEvidenceQuote(s,'已知距离916公里'),false)
 assert.equal(supportedEvidenceQuote('睡眠未记录。（来源：自述）','睡眠未记录。'),true)
 assert.equal(supportedEvidenceQuote('结论：不能恢复冲刺；需评估。','恢复冲刺'),false)
 assert.equal(supportedEvidenceQuote('距离=5000米；覆盖未知','5000米'),false)
})
import {contextPaceComparison} from './context-comparison'
import type {CoachRequestContext} from './online-contract'
test('stored pace comparisons compute the winner from two complete runs, independent of model prose',()=>{
 const records=[{d:4000,t:1200,day:'2026-10-20'},{d:4000,t:1080,day:'2026-10-22'}].map((x,i)=>({recordId:'run'+i,revision:'1',occurredAt:x.day+'T00:00:00Z',knownAt:x.day+'T00:00:00Z',source:'USER_DECLARED:MANUAL',state:'ACTUAL',category:'TRAINING',fields:[{name:'modality',value:'RUN',unit:null},{name:'knownDistance',value:x.d,unit:'m'},{name:'knownWorkTime',value:x.t,unit:'s'},{name:'paceSecondsPerKm',value:x.t*1000/x.d,unit:'s/km'},{name:'distanceComplete',value:true,unit:null}]})) as CoachRequestContext['records'];
 const c:CoachRequestContext={version:'coach-context-v2',dependencyVersions:[],records,coverage:{selected:2,omitted:0,unknowns:[]}};
 assert.match(contextPaceComparison('前后两次跑步哪次更快？',c).join(''),/2026-10-22这次更快.*5:00.*4:30/)
 assert.deepEqual(contextPaceComparison('今天恢复怎样？',c),[])
 assert.deepEqual(contextPaceComparison('哪次更快？',{...c,records:records.slice(0,1)}),[])
})
import {selfReportRangeComparison} from './context-comparison'
test('self-reported heart-rate comparisons use the supplied range rather than a population cutoff',()=>{
 assert.match(selfReportRangeComparison('静息心率通常约70–80，近两天分别为72和85。').join(''),/72.*处于.*85.*高于/)
 assert.match(selfReportRangeComparison('静息心率通常约70–80，近两天分别为68和69。').join(''),/68.*低于.*69.*低于/)
 assert.deepEqual(selfReportRangeComparison('静息心率通常约70–80，今天感觉很好。'),[])
 assert.deepEqual(selfReportRangeComparison('静息心率通常约80–70，近两天分别为72和85。'),[])
})
