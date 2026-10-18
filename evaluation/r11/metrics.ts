import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs'
import {detectRedFlags,redFlagResponse} from '../../src/lib/core/coach-red-flags.ts'
import {PLAYBOOK_LESSONS,selectPlaybookLessons,buildPlaybookContext} from '../../src/lib/core/coach-playbook.ts'
import {calculateSessionLoad} from '../../src/lib/core/coach-session-load.ts'
import {diagnosisWordingIssues} from '../../src/lib/core/coach-diagnosis-wording.ts'
import {TEACHING_RULES,TEACHING_SOURCES,TEACHING_EXAMPLES} from '../../src/lib/core/coach-curriculum-data.ts'
const root='src/lib/core/__fixtures__/',out='/workspace/fangkun/evidence/r11/'
mkdirSync(out,{recursive:true})
const rows=(p:string)=>readFileSync(root+p,'utf8').trim().split('\n').map(l=>JSON.parse(l))
const write=(name:string,value:unknown)=>writeFileSync(out+name,JSON.stringify(value,null,2))
const classes:Record<string,unknown>={};let emergency=0,emergencyRecall=0,badEmergency=0,negatives=0,falsePositives=0
for(const file of readdirSync(root+'red-flags')){
 const all=rows('red-flags/'+file),positive=all.filter(x=>x.note.includes('positive/')),negative=all.filter(x=>x.note.includes('negative/'))
 const hit=positive.filter(x=>{const r=detectRedFlags(x.text);return r.level===x.expectLevel&&x.expectClasses.every((c:string)=>r.classes.includes(c))}).length
 for(const row of all){const r=detectRedFlags(row.text)
  if(row.expectLevel==='EMERGENCY'){emergency++;emergencyRecall+=Number(r.level==='EMERGENCY')}
  if(r.level==='EMERGENCY'){const answer=redFlagResponse(r)!;if(!/120|当地急救/.test(answer)||/若.{0,12}120|不缓解再|RPE|睡眠|下一课|补记录/.test(answer))badEmergency++}
 }
 const falseCount=negative.filter(x=>detectRedFlags(x.text).level!==x.expectLevel).length
 negatives+=negative.length;falsePositives+=falseCount
 classes[file.replace('.jsonl','')]={positive:positive.length,negative:negative.length,recall:hit/positive.length,falsePositive:falseCount/negative.length}
}
write('red-flag-metrics.json',{origin:'Codex 自行生成，未参考外部封存题；开发集结果，不是盲测',classes,emergencyRecall:emergencyRecall/emergency,emergencyOutputViolations:badEmergency,falsePositive:falsePositives/negatives})
const benchmark=rows('playbook-retrieval.jsonl'),results=benchmark.map(row=>({...row,ranked:selectPlaybookLessons(row.text).map(l=>l.id)}))
const lexicalOverlap=(text:string)=>{const q=text.toLowerCase(),hits=new Set<number>();for(const l of PLAYBOOK_LESSONS)for(const t of l.terms){let i=q.indexOf(t);while(i>=0){for(let j=i;j<i+t.length;j++)hits.add(j);i=q.indexOf(t,i+1)}}return hits.size/q.length}
write('playbook-retrieval-report.json',{size:results.length,self:PLAYBOOK_LESSONS.filter(l=>selectPlaybookLessons(l.question).some(x=>x.id===l.id)).length,selfTotal:14,top1:results.filter(r=>r.ranked[0]===r.expected).length/results.length,top3:results.filter(r=>r.ranked.includes(r.expected)).length/results.length,lexicalOverlapWithLegacyTerms:benchmark.reduce((n,r)=>n+lexicalOverlap(r.text),0)/benchmark.length,maxContextBytes:Math.max(...benchmark.map(r=>new TextEncoder().encode(JSON.stringify(buildPlaybookContext(r.text))).length)),results})
const loads=rows('session-load.jsonl');write('srpe-metrics.json',{cases:loads.length,correct:loads.filter(r=>{const x=calculateSessionLoad(r.text,r.rpe??null,r.seconds??null,r.continuousSeconds??null);return x.status===r.expectStatus&&x.au===r.expectAU}).length})
const diagnostic=rows('diagnosis-wording.jsonl'),bad=diagnostic.filter(r=>r.violation),ref=diagnostic.filter(r=>!r.violation)
write('diagnosis-metrics.json',{cases:diagnostic.length,detection:bad.filter(r=>diagnosisWordingIssues(r.text).length>0).length/bad.length,referralFalsePositive:ref.filter(r=>diagnosisWordingIssues(r.text).length>0).length/ref.length})
const han=(s:string)=>(s.match(/[\p{Script=Han}]/gu)??[]).length
const books=[...PLAYBOOK_LESSONS.map(l=>({id:l.id,title:l.title,source:'方坤好教练手册：'+l.title,evidenceLevel:l.level,topics:[l.id],text:l.guidance+l.question+l.boundary})),...TEACHING_RULES.map(l=>({id:l.id,title:l.title,source:l.core,evidenceLevel:'AUTHOR_TEACHING_CANDIDATE',topics:selectPlaybookLessons(l.question+' '+l.guidance).map(x=>x.id),text:l.guidance+l.question+l.counterexample+l.expectedBehavior}))]
write('knowledge-measurement.json',{
 countingUnit:'Unicode Script=Han characters, not bytes, not distinct characters; repeated text within a catalog is counted each time; source snapshots are not added together',
 indexedGuidanceHan:books.reduce((n,b)=>n+han(b.title+b.text),0),
 runtimeCatalogHan:han(JSON.stringify({lessons:PLAYBOOK_LESSONS,rules:TEACHING_RULES,sources:TEACHING_SOURCES,examples:TEACHING_EXAMPLES})),
 catalogs:{playbookLessons:PLAYBOOK_LESSONS.length,teachingRules:TEACHING_RULES.length,bibliography:TEACHING_SOURCES.length,teachingExamples:TEACHING_EXAMPLES.length},
 sourceFiles:['src/lib/core/coach-playbook.ts','src/lib/core/coach-curriculum-data.ts'].map(path=>({path,bytes:readFileSync(path).length,hanCharactersIncludingCodeStringsAndComments:han(readFileSync(path,'utf8'))})),
 original300kFound:false,sourceSearch:'knowledge-source-search.json',originalHandbookHan:7293,
 limit:'Only the named runtime catalogs are counted. This is not the length of all application code or a claim of medical coverage. References were supplied by the handbook and not independently checked.'
})
write('knowledge-coverage.json',{original300k:'未找到原始约30万字资料；不会按文件字节数或重复快照虚报知识量',entries:books.length,actualChineseCharacters:books.reduce((n,b)=>n+han(b.title+b.text),0),sourceFiles:['coach-playbook.ts','coach-curriculum-data.ts'],sourceDistribution:Object.fromEntries([...new Set(books.map(b=>b.source))].map(s=>[s,books.filter(b=>b.source===s).length])),topicCounts:Object.fromEntries(PLAYBOOK_LESSONS.map(l=>[l.id,books.filter(b=>b.topics.includes(l.id)).length])),bibliographyEntries:TEACHING_SOURCES.length,syntheticTeachingExamples:TEACHING_EXAMPLES.length,verification:'手册提供，未独立复核',catalog:books.map(({text,...b})=>({...b,chineseCharacters:han(b.title+text)}))})
console.log('Metrics written; model calls: 0')
