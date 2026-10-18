import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchEvent, loadEvents, setEventContext } from './events.ts'
import { setStoreBackend, readEnvelope, writeEnvelope, type MemoryStore } from './storage.ts'
import { applyAdjustment, createTrainingDecision, evaluateTrainingReadiness, readTrainingContext, validateTrainingDecision, type TrainingDecision, type TrainingContext } from './training-decision.ts'
import { outcomeFeedback } from './brain-loop.ts'
import type { Session } from '@/lib/strength/model'

function memory(): MemoryStore {
  const m = new Map<string,string>()
  return { keys:()=>[...m.keys()], getItem:k=>m.get(k)??null, setItem:(k,v)=>{m.set(k,v)} }
}
function ctx(input: Partial<TrainingContext> = {}): TrainingContext {
  return { fatigue:20, pain:false, rehab:false, sleepHours:null, recentRunKm:null, recentRunRpe:null, daysToCompetition:null, week:2, bias:'build', previousFeel:null, facts:3, ...input }
}

test('P0-01 heuristic fatigue index alone cannot establish READY/recovery',()=>{
  assert.equal(evaluateTrainingReadiness(ctx()), 'CAUTION')
  const decision=createTrainingDecision(ctx(), { name:'半蹲', moveId:'squat', sets:4, amount:8, weightKg:80 })
  assert.equal(decision.change,'none')
  assert.equal(decision.confidence<=.4,true)
})

test('P0-02 reduction only for identified move; never increases 1-set move',()=>{
  const source:Session={id:'s',name:'下肢',moves:[
    {id:'squat',catalogId:null,customName:'半蹲',sets:4,mode:'reps',amount:8,weightKg:80,restSec:120},
    {id:'hinge',catalogId:null,customName:'髋伸',sets:1,mode:'reps',amount:8,weightKg:40,restSec:90},
  ]}
  const suggestion={ change:'drop-set', targetMoveId:'squat', sets:3 } as TrainingDecision
  const result=applyAdjustment(source,suggestion)
  assert.equal(result.moves[0]?.sets,3)
  assert.equal(result.moves[1]?.sets,1)
  assert.equal(source.moves[0]?.sets,4)
  assert.equal(source.moves[1]?.sets,1)
  const ambiguous=applyAdjustment(source,{change:'drop-set',sets:3} as TrainingDecision)
  assert.deepEqual(ambiguous,source)
  const oneSet=applyAdjustment(source,{change:'drop-set',targetMoveId:'hinge',sets:1} as TrainingDecision)
  assert.equal(oneSet.moves[1]?.sets,1)
})

test('P0-03 separate occurrences of same plan must not combine strength sets',()=>{
  setStoreBackend(memory())
  try {
    dispatchEvent('TRAINING_SET_COMPLETED',{ sessionId:'same-plan',trainingOccurrenceId:'start-day1',mode:'reps',plannedAmount:8,actualAmount:8,plannedWeight:80,actualWeight:80,completed:true,skipped:false })
    dispatchEvent('TRAINING_SET_COMPLETED',{ sessionId:'same-plan',trainingOccurrenceId:'start-day1',mode:'reps',plannedAmount:8,actualAmount:8,plannedWeight:80,actualWeight:80,completed:true,skipped:false })
    dispatchEvent('TRAINING_SET_COMPLETED',{ sessionId:'same-plan',trainingOccurrenceId:'start-day2',mode:'reps',plannedAmount:8,actualAmount:6,plannedWeight:80,actualWeight:80,completed:true,skipped:false })
    const review=readTrainingContext(null).snapshot?.strength
    assert.equal(review?.plannedSets,1)
    assert.equal(review?.completedReps,6)
  } finally {setStoreBackend(null)}
})

test('P0-04 completion must not be counted as correct coach prediction',()=>{
  setStoreBackend(memory())
  try {
    dispatchEvent('TRAINING_COMPLETED',{decisionId:'d1',sessionId:'s',setsPlanned:4,setsCompleted:4,completion:true,modifications:false,interruptions:false,rpe:7})
    assert.ok(outcomeFeedback('d1'))
    const saved=readEnvelope<{learning:{decisionId:string;success:boolean|null;validation:string;prediction:string}[]}>('fr255-memory-v1',{learning:[]}).data
    assert.equal(saved.learning.length,1)
    assert.equal(saved.learning[0]?.success,null)
    assert.equal(saved.learning[0]?.validation,'NOT_TESTABLE')
  } finally {setStoreBackend(null)}
})

test('P0-03 integrated two starts, two completions, distinct occurrence IDs and RPE', async()=>{
  setStoreBackend(memory())
  try {
    const {bindTrainingStart,markOccurrenceClosed}=await import('./occurrence.ts')
    const {completeTraining}=await import('./training-decision.ts')
    const plan:Session={id:'repeat-day',name:'力量',moves:[{id:'squat',catalogId:null,customName:'半蹲',sets:1,mode:'reps',amount:8,weightKg:80,restSec:120}]}
    for(const [reps,rpe] of [[8,6],[6,9]]){
      const start=dispatchEvent('TRAINING_STARTED',{sessionId:'repeat-day',decisionId:'day-'+rpe})!
      const occ=bindTrainingStart({startEventId:start.event_id,startedAt:start.timestamp,sessionId:'repeat-day',planSlotId:'repeat-day',plan})
      assert.equal(occ?.trainingOccurrenceId,start.event_id)
      dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'repeat-day',trainingOccurrenceId:start.event_id,moveId:'squat',setIndex:1,mode:'reps',plannedAmount:8,actualAmount:reps,plannedWeight:80,actualWeight:80,completed:true,skipped:false})
      const finished=completeTraining({decisionId:'day-'+rpe,sessionId:'repeat-day',planned:{name:'半蹲',sets:1,amount:8,weightKg:80},actualSets:1,actualAmount:reps,actualWeightKg:80,rpe,pain:false,modified:reps!==8,interrupted:false})
      assert.ok(finished)
      assert.equal(finished?.payload.trainingOccurrenceId,start.event_id)
      markOccurrenceClosed(start.event_id,{kind:'COMPLETED',endedAt:finished?.timestamp??null})
    }
    const latest=readTrainingContext(null).snapshot?.strength
    assert.equal(latest?.plannedSets,1)
    assert.equal(latest?.completedReps,6)
    assert.equal(latest?.strengthRpe,9)
  } finally {setStoreBackend(null)}
})

test('P0-03 legacy reused session ID without occurrence marker must degrade to UNKNOWN',()=>{
  setStoreBackend(memory())
  try{
    dispatchEvent('TRAINING_STARTED',{sessionId:'legacy-reused',decisionId:'a'})
    dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'legacy-reused',mode:'reps',plannedAmount:8,actualAmount:8,plannedWeight:80,actualWeight:80,completed:true,skipped:false})
    dispatchEvent('TRAINING_STARTED',{sessionId:'legacy-reused',decisionId:'b'})
    dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'legacy-reused',mode:'reps',plannedAmount:8,actualAmount:6,plannedWeight:80,actualWeight:80,completed:true,skipped:false})
    const seen=readTrainingContext(null).snapshot?.strength
    assert.equal(seen?.plannedSets,null)
    assert.equal(seen?.completedReps,null)
  }finally{setStoreBackend(null)}
})

test('P0-03 even when two athlete IDs reuse a slot, sets are never combined', async()=>{
  const {setEventContext}=await import('./events.ts')
  setStoreBackend(memory())
  try {
    setEventContext({athleteId:'athlete-one'})
    dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'same',trainingOccurrenceId:'one',mode:'reps',plannedAmount:8,actualAmount:8,plannedWeight:60,actualWeight:60,completed:true,skipped:false})
    setEventContext({athleteId:'athlete-two'})
    dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'same',trainingOccurrenceId:'two',mode:'reps',plannedAmount:8,actualAmount:6,plannedWeight:60,actualWeight:60,completed:true,skipped:false})
    const seen=readTrainingContext(null).snapshot?.strength
    assert.equal(seen?.plannedSets,1)
    assert.equal(seen?.completedReps,6)
  } finally {setEventContext({athleteId:'local'});setStoreBackend(null)}
})

test('P0-01 low heuristic does not override competition or deload restrictions',()=>{
  const planned={name:'半蹲',sets:4,amount:8,weightKg:60}
  const near=createTrainingDecision(ctx({daysToCompetition:10}),planned)
  assert.equal(near.change,'hold')
  assert.equal(near.risk,'MODERATE')
  assert.match(near.reason,/28 天/)
  for(const input of [{week:4 as const},{bias:'deload' as const},{bias:'hold' as const}]){
    assert.equal(createTrainingDecision(ctx(input),planned).change,'hold')
  }
})

test('P0-01 pain, rehab and unknown remain protective; low index cannot authorize increased load',()=>{
  const planned={name:'半蹲',sets:4,amount:8,weightKg:60}
  for(const input of [{pain:true},{rehab:true},{previousFeel:'pain' as const}]){
    const decision=createTrainingDecision(ctx(input),planned)
    assert.equal(decision.change,'hold')
    assert.equal(decision.risk,'CRITICAL')
    assert.equal(validateTrainingDecision(ctx(input),planned,{...planned,weightKg:65}).allowed,false)
  }
  assert.equal(evaluateTrainingReadiness(ctx({fatigue:null,facts:0})),'UNKNOWN')
  assert.equal(validateTrainingDecision(ctx(),planned,{...planned,sets:5}).allowed,false)
})

test('P0-02 single set and duplicate move identities cannot increase or modify other moves',()=>{
  const planned={name:'半蹲',moveId:'squat',sets:1,amount:8,weightKg:60}
  const decision=createTrainingDecision(ctx({fatigue:80}),planned)
  assert.equal(decision.sets,1)
  assert.notEqual(decision.change,'drop-set')
  const move={id:'squat',catalogId:null,customName:'半蹲',sets:4,mode:'reps' as const,amount:8,weightKg:60,restSec:90}
  const duplicate:Session={id:'s',name:'合成课',moves:[{...move},{...move}]}
  const before=structuredClone(duplicate)
  assert.deepEqual(applyAdjustment(duplicate,{change:'drop-set',targetMoveId:'squat',sets:3} as TrainingDecision),before)
  assert.deepEqual(duplicate,before)
})

test('P0-03 switching back to an athlete never selects the latest other-athlete session',()=>{
  setStoreBackend(memory())
  try{
    for(const [athlete,reps] of [['athlete-a',8],['athlete-b',5]] as const){
      setEventContext({athleteId:athlete})
      dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'same',trainingOccurrenceId:'same-occurrence',mode:'reps',plannedAmount:8,actualAmount:reps,completed:true})
    }
    setEventContext({athleteId:'athlete-a'})
    const before=JSON.stringify(loadEvents())
    assert.equal(readTrainingContext(null).snapshot?.strength.completedReps,8)
    assert.equal(JSON.stringify(loadEvents()),before)
    setEventContext({athleteId:'athlete-with-no-data'})
    assert.equal(readTrainingContext(null).snapshot?.strength.completedReps,null)
  }finally{setEventContext({athleteId:'local'});setStoreBackend(null)}
})

test('P0-03 empty occurrence IDs cannot legitimize mixing repeated legacy sessions',()=>{
  setStoreBackend(memory())
  try{
    for(const reps of [8,6]){
      dispatchEvent('TRAINING_STARTED',{sessionId:'legacy-empty'})
      dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'legacy-empty',trainingOccurrenceId:'',mode:'reps',plannedAmount:8,actualAmount:reps,completed:true})
    }
    assert.equal(readTrainingContext(null).snapshot?.strength.completedReps,null)
  }finally{setStoreBackend(null)}
})

test('P0-03 legacy unbound sets cannot borrow RPE from a bound completion',()=>{
  setStoreBackend(memory())
  try{
    dispatchEvent('TRAINING_COMPLETED',{sessionId:'legacy',idempotencyKey:'occurrence:older-bound-session',rpe:9,completion:true})
    dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:'legacy',mode:'reps',plannedAmount:8,actualAmount:6,completed:true})
    const seen=readTrainingContext(null).snapshot?.strength
    assert.equal(seen?.completedReps,6)
    assert.equal(seen?.strengthRpe,null)
    assert.equal(seen?.completionStatus,null)
  }finally{setStoreBackend(null)}
})

test('P0-03 completing an athlete session cannot bind to another athlete occurrence',async()=>{
  setStoreBackend(memory())
  try{
    const {bindTrainingStart,markOccurrenceClosed}=await import('./occurrence.ts')
    const {completeTraining}=await import('./training-decision.ts')
    const input={decisionId:'shared-decision',sessionId:'shared-template',planned:null,actualSets:1,actualAmount:8,actualWeightKg:60,rpe:6,pain:false,modified:false,interrupted:false}
    setEventContext({athleteId:'athlete-a'})
    const a=dispatchEvent('TRAINING_STARTED',{sessionId:input.sessionId,decisionId:input.decisionId})!
    bindTrainingStart({startEventId:a.event_id,startedAt:a.timestamp,sessionId:input.sessionId,planSlotId:input.sessionId,plan:null})
    const doneA=completeTraining(input)!
    markOccurrenceClosed(a.event_id,{kind:'COMPLETED',endedAt:doneA.timestamp})
    setEventContext({athleteId:'athlete-b'})
    const b=dispatchEvent('TRAINING_STARTED',{sessionId:input.sessionId,decisionId:input.decisionId})!
    bindTrainingStart({startEventId:b.event_id,startedAt:b.timestamp,sessionId:input.sessionId,planSlotId:input.sessionId,plan:null})
    completeTraining({...input,rpe:9})
    setEventContext({athleteId:'athlete-a'})
    const retry=completeTraining(input)!
    assert.equal(retry.athlete_id,'athlete-a')
    assert.equal(retry.event_id,doneA.event_id)
    assert.equal(retry.payload.trainingOccurrenceId,a.event_id)
  }finally{setEventContext({athleteId:'local'});setStoreBackend(null)}
})

test('P0-04 feedback preserves historical records and formal plan; repeated reads do not create validation successes',()=>{
  const box=memory();setStoreBackend(box)
  try{
    const previous={decisionId:'historical',success:true,prediction:'旧判断',actual:'COMPLETED_AS_PLANNED'}
    const ability={strength:77,source:'historical-user-record'}
    writeEnvelope('fr255-memory-v1',{learning:[previous],notes:['保留'],ability})
    const plan='{"synthetic":"formal-plan-preserved"}'
    box.setItem('fr255-strength-plan-v3',plan)
    dispatchEvent('TRAINING_COMPLETED',{decisionId:'new-result',sessionId:'s',setsPlanned:4,setsCompleted:4,completion:true})
    const events=JSON.stringify(loadEvents())
    outcomeFeedback('new-result');outcomeFeedback('new-result')
    const result=readEnvelope<{learning:Record<string,unknown>[];notes:string[];ability:unknown}>('fr255-memory-v1',{learning:[],notes:[],ability:null}).data
    assert.equal(result.learning.length,2)
    assert.deepEqual(result.learning[0],previous)
    assert.equal(result.learning[1]?.success,null)
    assert.equal(result.learning[1]?.validation,'NOT_TESTABLE')
    assert.deepEqual(result.ability,ability)
    assert.deepEqual(result.notes,['保留'])
    assert.equal(JSON.stringify(loadEvents()),events)
    assert.equal(box.getItem('fr255-strength-plan-v3'),plan)
  }finally{setStoreBackend(null)}
})
