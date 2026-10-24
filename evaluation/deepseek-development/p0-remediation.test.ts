import test from 'node:test'
import assert from 'node:assert/strict'
import {modelFixtures} from './model-fixtures'
import {prepareAB} from './prepare-chain-ab'
import {projectAnalysisEvidence,analysisReference} from '../../src/lib/health/analysis-evidence'
import {evaluateRecoveryEvidence} from '../../src/lib/health/recovery-assessment'
import type {MetricFact} from '../../src/lib/health/analysis-contract'
const fixture=(id:string)=>modelFixtures().find(f=>f.caseId===id)!
test('D04 identified RMSSD stays available and five matching baseline days are actually calculated',()=>{
 const f=fixture('D04'),s=projectAnalysisEvidence(f),a=evaluateRecoveryEvidence(s)
 assert.ok(!a.missingDecisionInputs.some(x=>x.includes('HRV未记录')))
 const current=s.facts.find(x=>x.id==='hrv-current') as MetricFact,b=analysisReference(s,current)
 assert.equal(b.sampleCount,5);assert.equal(b.median,60);assert.equal(b.deltaPercent,-20)
 assert.match(a.observations.map(x=>x.text).join('\n'),/lnRMSSD.*-0\.22314/)
 const rhr=analysisReference(s,s.facts.find(x=>x.id==='rhr-current') as MetricFact);assert.equal(rhr.median,50);assert.equal(rhr.deltaPercent,20)
})
for(const id of ['E01','E04','E05'])test(`${id} includes historical and adverse observations rather than only 72-hour facts`,()=>{
 const f=fixture(id),a=evaluateRecoveryEvidence(projectAnalysisEvidence(f)),text=a.observations.map(x=>x.text).join('\n')
 if(id==='E01'){assert.match(text,/2026-10-15/);assert.match(text,/2026-10-16/);assert.match(text,/39/)}
 if(id==='E04'){assert.match(text,/旧假设/);assert.match(text,/近期疲劳影响后程/);assert.match(text,/3.*8/);assert.match(text,/反证|削弱/)}
 if(id==='E05'){assert.match(text,/2026-10-15/);assert.match(text,/2026-10-16/);assert.match(text,/未记录|未完成/);assert.match(text,/35/)}
})
test('paid subset replaces only C02/E03 with A03/F03 and uses neutral readable source text for both arms',()=>{
 const ids=['A03','C03','C04','C07','D01','D04','D05','E01','E02','E04','E05','E06','F03']
 const r=prepareAB(modelFixtures(),'one-model',{caseIds:ids} as any)
 assert.equal(r.requests.length,26);assert.deepEqual(r.blocked,[])
 assert.deepEqual([...new Set(r.requests.map(x=>x.caseId))].sort(),ids.sort())
 for(let i=0;i<r.requests.length;i+=2){const a=r.requests[i],b=r.requests[i+1];assert.equal(a.sourceText,b.sourceText);assert.equal(a.coverageHash,b.coverageHash);assert.deepEqual(a.generation,b.generation);assert.ok(!a.sourceText.includes('sourceColumns'));assert.ok(!/expectedMetrics|评分标准/.test(JSON.stringify([a.providerRequest,b.providerRequest])))}
})
test('frozen rubric and original sixty questions stay immutable; neither prompt contains evaluator-only material',async()=>{
 const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');const bytes=readFileSync(new URL('./scoring-frozen.json',import.meta.url)),digest=createHash('sha256').update(bytes).digest('hex');assert.equal(digest,readFileSync(new URL('./scoring-frozen.sha256',import.meta.url),'utf8').trim());const rules=JSON.parse(bytes.toString());assert.equal(createHash('sha256').update(readFileSync(new URL('./cases-60.json',import.meta.url))).digest('hex'),rules.sourceSha256);assert.equal(rules.cases.length,60);assert.equal(rules.cases.filter((x:any)=>x.paid).length,13)
 const {blindExport}=await import('./blind-export'),requests=prepareAB(modelFixtures(),'deepseek-flash',{caseIds:rules.paidSubset}).requests,samples=requests.map((r:any,i:number)=>({sampleId:'sample-'+i,caseId:r.caseId,arm:r.arm,request:r})),receipts=samples.map(s=>({sampleId:s.sampleId,rawAnswer:'原始回答',state:'SETTLED',transportErrors:[]})),b=blindExport(receipts,samples,rules);assert.equal(b.reviewerSheets.length,26);assert.ok(b.reviewerSheets.every(x=>!('arm'in x)&&!('caseId'in x)&&!('providerRequest'in x)));assert.equal(b.privateMapping.length,26)
})
