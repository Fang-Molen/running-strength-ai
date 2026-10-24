import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {retrieveR4} from './reference'
import {suggestR4Tasks,buildR4Review} from './assessment'
import {context,metric,training,set} from '../../health/analysis-fixtures'
import {projectAnalysisEvidence} from '../../health/analysis-evidence'

test('all original R4 bytes match the publisher manifest and every card source resolves',()=>{
 const root=new URL('../../../../knowledge/professional-r4-20261024/',import.meta.url)
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'))
 for(const f of manifest.files)assert.equal(createHash('sha256').update(readFileSync(new URL(f.path,root))).digest('hex'),f.sha256,f.path)
 const cards=JSON.parse(readFileSync(new URL('knowledge/retrieval-cards.json',root),'utf8'))
 const sources=JSON.parse(readFileSync(new URL('knowledge/sources.json',root),'utf8')).sources
 assert.equal(cards.length,28);assert.equal(sources.length,15)
 for(const c of cards){assert.equal(c.autoExecute,false);for(const id of c.sourceIds)assert.ok(sources.some((s:{id:string})=>s.id===id))}
 const c=retrieveR4({question:'只问饮食',tasks:['nutrition'],population:'healthy_adult',fields:{foodEntries:[{}]}})
 assert.ok(c.cards.every(x=>x.status==='REFERENCE_ONLY'&&x.applicability==='NOT_ESTABLISHED'))
 assert.doesNotMatch(JSON.stringify(c),/referenceAnswer|expectedDecision/)
})
test('food-only scope and other-person questions do not acquire unrelated personal facts',()=>{
 assert.deepEqual(suggestR4Tasks('不谈跑步和HRV，只问饮食'),['nutrition'])
 const s=projectAnalysisEvidence({context,facts:[metric({value:8})]})
 const r=buildR4Review(s,'朋友的睡眠可以这样解释吗？',{population:'healthy_adult'})
 assert.equal(r.personalFactsUsed,false);assert.deepEqual(r.baselines,[]);assert.equal(r.selection.population,'unknown')
})
test('six-week two-athlete replay stays scoped, deterministic and separates strength evidence',()=>{
 for(let week=1;week<=6;week++)for(const athleteId of ['adult-a','adult-b']){
  const day=`2026-10-${String(week+10).padStart(2,'0')}`,asOf=day+'T20:00:00Z'
  const meta={athleteId,occurredAt:day+'T08:00:00Z',knownAt:day+'T09:00:00Z',receivedAt:day+'T09:00:00Z'}
  const run=training({...meta,id:'run-'+week,sourceRecordId:'run-'+week,modality:'RUN',strengthSets:[],runSegments:[{id:'r',blockId:'main',roundIndex:1,stepIndex:1,distanceM:5000,durationSeconds:1500,restAfterSeconds:0,rawResolutionSeconds:1,gradePercent:0,surface:'track',completion:'COMPLETED'}],startedAt:day+'T08:00:00Z'})
  const strength=training({...meta,id:'lift-'+week,sourceRecordId:'lift-'+week,startedAt:day+'T08:00:00Z',strengthSets:[set()]})
  const facts=athleteId==='adult-a'?[run,strength]:[run]
  facts.push(training({...run,id:'foreign',sourceRecordId:'foreign',athleteId:'foreign'}))
  const s=projectAnalysisEvidence({context:{...context,athleteId,asOf},facts})
  const first=buildR4Review(s,'分项能力与个人基线',{population:'healthy_adult'})
  assert.deepEqual(first,buildR4Review(s,'分项能力与个人基线',{population:'healthy_adult'}))
  assert.equal(first.capability.overallScore,null)
  assert.equal(first.capability.strength.status,athleteId==='adult-a'?'OBSERVED':'UNKNOWN')
  assert.ok(!JSON.stringify(first.capability).includes('foreign'))
  assert.equal(first.autoExecute,false)
 }
})
