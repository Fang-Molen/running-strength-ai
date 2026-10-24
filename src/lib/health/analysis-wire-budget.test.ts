import test from 'node:test'
import assert from 'node:assert/strict'
import {context,training} from './analysis-fixtures'
import {projectAnalysisEvidence} from './analysis-evidence'
import {evaluateRecoveryEvidence} from './recovery-assessment'
import {buildMuscleExposure} from './muscle-exposure'
import {analysisModelView,buildCoachAnalysisPacket} from './analysis-packet'

test('model wire keeps raw evidence and required calculations while removing repeated context metadata',()=>{
 const t=training({modality:'RUN',componentId:'run',strengthSets:[],runSegments:[30,34,38,42].map((durationSeconds,i)=>({id:'s'+i,blockId:'main',roundIndex:1,stepIndex:i+1,distanceM:200,durationSeconds,restAfterSeconds:120,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED'}))})
 const s=projectAnalysisEvidence({context,facts:[t]}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s),{question:'距离比赛还有多少天？',competitionDate:'2026-10-26'})
 const wire=analysisModelView(p)
 assert.ok(wire.compactView)
 assert.equal(wire.compactView.facts.length,wire.view.facts.length)
 assert.deepEqual(wire.compactView.derivedFacts.map((d:any)=>d.id).sort(),wire.view.requirements.requiredDerivedFactIds.slice().sort())
 assert.deepEqual(wire.compactView.calendarContext,wire.view.calendarContext)
 assert.equal(wire.compactView.asOf,wire.view.asOf)
 assert.equal(wire.compactView.derivedFormulaVersion,'FK_DERIVED_1')
 assert.ok(JSON.stringify(wire.compactView).length<JSON.stringify(wire.view).length)
 assert.deepEqual(wire.restore({derivedFactIds:wire.compactView.derivedFacts.map((d:any)=>d.id)}).derivedFactIds?.sort(),p.requirements!.requiredDerivedFactIds.slice().sort())
})
