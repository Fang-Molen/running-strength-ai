/** Deterministic PUBLIC_SYNTHETIC review evidence. No model, browser or user store. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {context,metric,training,set} from '../../src/lib/health/analysis-fixtures'
import type {AnalysisFact,Context,TrainingFact,ResponseFact} from '../../src/lib/health/analysis-contract'
import {projectAnalysisEvidence} from '../../src/lib/health/analysis-evidence'
import {deriveAnalysisFacts} from '../../src/lib/health/analysis-derived'
import {evaluateRecoveryEvidence} from '../../src/lib/health/recovery-assessment'
import {buildR4Review,type R4ReviewOptions} from '../../src/lib/coach/r4/assessment'
import {scaleR4Reference,R4_VERSION,type R4Task} from '../../src/lib/coach/r4/reference'

const at=(day:string)=>day+'T08:00:00Z'
const date=(offset:number)=>new Date(Date.UTC(2026,8,1+offset)).toISOString().slice(0,10)
function run(id:string,times:number[],distanceM:number,day='2026-10-22'):TrainingFact{
 return training({id,sourceRecordId:id,canonicalActivityId:id,occurrenceId:id,componentId:'running',modality:'RUN',strengthSets:[],startedAt:at(day),occurredAt:at(day),knownAt:at(day),receivedAt:at(day),protocolKey:'track-standing-hand-timed',
  runSegments:times.map((durationSeconds,i)=>({id:id+'-'+i,blockId:'main',roundIndex:1,stepIndex:i+1,distanceM,durationSeconds,restAfterSeconds:120,rawResolutionSeconds:1,gradePercent:0,surface:'track',completion:'COMPLETED'}))})
}
function measurement(id:string,day:string,value:number|null,name='RMSSD',device='watch-a'){
 return metric({id,sourceRecordId:id,accountRef:'public-synthetic-manual-scope',occurredAt:at(day),knownAt:at(day),receivedAt:at(day),providerDate:day,value,metric:name,deviceId:device,protocolKey:name==='RMSSD'?'night-rmssd':'same-morning',unit:name==='RHR'?'bpm':name==='SLEEP'?'h':'ms',statistic:'DAILY_MEAN'})
}
function response(id:string,measure:ResponseFact['measure'],value:number,scale:string):ResponseFact{
 return {...metric(),id,sourceRecordId:id,kind:'RESPONSE',measure,value,scale,relatedTrainingRefs:[],region:'hamstrings',side:'BILATERAL',observationProtocol:'public-synthetic-self-report',elapsedHours:24,functionTaskId:'walking',notes:null}
}
export function projectReview(question:string,facts:AnalysisFact[],options:R4ReviewOptions={},ctx:Context=context){
 const snapshot=projectAnalysisEvidence({context:ctx,facts}),review=buildR4Review(snapshot,question,options)
 return {snapshotId:snapshot.snapshotId,inputRevision:snapshot.inputDigest,visibleRefs:snapshot.facts.map(f=>({id:f.id,revision:f.revision})),excluded:snapshot.excluded,
  review,calculations:deriveAnalysisFacts(snapshot),assessment:evaluateRecoveryEvidence(snapshot),saved:false,planWritten:false,modelCalled:false}
}
const calc=(output:ReturnType<typeof projectReview>,name:string,ref?:string)=>output.calculations.find(c=>c.metric===name&&(!ref||c.evidenceRefs.some(r=>r.id===ref)))?.value

// Only original input text reaches application functions. Answers and expectations
// are read after generation and remain in the evaluator's result document.
export function teachingReplay(){
 const teaching=JSON.parse(readFileSync(new URL('../../knowledge/professional-r4-20261024/knowledge/teaching-cases.json',import.meta.url),'utf8')) as {id:string;input:string;expectedDecision:string;referenceAnswer:string;check:string}[]
 const tasks:Record<string,R4Task[]>={C01:['nutrition','running'],C02:['baseline','fatigue'],C03:['running'],C04:['running','memory'],C05:['fatigue'],C06:['capability'],C07:['baseline'],C08:['strength','planning'],C09:['running','strength','planning'],C10:['strength'],C11:['strength'],C12:['strength','running'],C13:['warmup'],C14:['planning'],C15:['nutrition'],C16:['nutrition'],C17:['nutrition'],C18:['nutrition'],C19:['planning'],C20:['memory','running']}
 return teaching.map(({id,input})=>{
  const facts:AnalysisFact[]=[],options:R4ReviewOptions={tasks:tasks[id],population:'unknown'}
  if(id==='C01')options.foods=[{kcal:400,protein:null,carb:null,fat:null,fiber:null}]
  if(id==='C02'){
   for(let i=0;i<5;i++)facts.push(measurement('rhr-'+i,'2026-10-'+(17+i),50,'RHR'),measurement('rmssd-'+i,'2026-10-'+(17+i),60))
   facts.push(measurement('rhr-today','2026-10-22',60,'RHR'),measurement('rmssd-today','2026-10-22',48))
  }
  if(id==='C03')facts.push(run('four-1000',[230,240,250,260],1000))
  if(id==='C04')facts.push(run('before',[30,31,32,33],200,'2026-10-15'),run('today',[30,31,32,33],200),response('recovery','RECOVERY_FEELING',8,'1-10_HIGH_BETTER'))
  if(id==='C05')facts.push(metric({id:'readiness',sourceRecordId:'readiness',metric:'READINESS',value:90,statistic:'PROVIDER_ASSESSMENT',unit:'provider score'}),response('pain','PAIN',3,'0-10_HIGH_WORSE'),response('function','FUNCTION',1,'FUNCTION_LIMITATION_0_1'))
  if(id==='C06')facts.push(run('800m',[180],800))
  if(id==='C07')facts.push(measurement('old-watch','2026-10-18',55,'RMSSD','garmin'),measurement('new-watch','2026-10-21',45,'RMSSD','coros'))
  if(id==='C10')facts.push(training({strengthSets:[set({id:'s1',loadKg:20,reps:8}),set({id:'s2',loadKg:20,reps:8})]}))
  if(id==='C15')options.foods=[{kcal:null,protein:null,carb:null,fat:null,fiber:null}]
  if(id==='C16')facts.push(metric({id:'total',sourceRecordId:'total',metric:'TOTAL_KCAL',value:2400,unit:'kcal',energyKind:'TOTAL'}),metric({id:'workout',sourceRecordId:'workout',metric:'WORKOUT_KCAL',value:600,unit:'kcal',energyKind:'WORKOUT'}))
  if(id==='C17')options.population='healthy_adult'
  if(id==='C20'){const old=run('revised',[180],1000,'2026-10-15');facts.push(old,{...old,id:'revision-2',revision:2,runSegments:[{...old.runSegments[0],durationSeconds:210}],knownAt:at('2026-10-22'),receivedAt:at('2026-10-22')})}
  const actualOutput=projectReview(input,facts,options)
  const extra=id==='C17'?scaleR4Reference({referenceId:'N-CARB',contextIndex:1,weightKg:60,population:'healthy_adult'}):null
  const expected=teaching.find(c=>c.id===id)!
  return {caseId:id,knowledgeVersion:R4_VERSION,inputVersion:'PUBLIC_SYNTHETIC_R4_REVIEW_1',input:{question:input,facts,options},actualOutput,referenceCalculation:extra,
   expected:expected.expectedDecision,evaluatorOnly:{referenceAnswer:expected.referenceAnswer,check:expected.check},
   verdict:'PARTIAL_DETERMINISTIC_OUTPUT_NOT_APP_ACCEPTED',failureReason:'仅生成真实确定性投影；未进行浏览器交互、模型解释或独立专业评审。文字中的批准不构成已签名课程权限。'}
 })
}

export function sixWeekReplay(){
 const facts:AnalysisFact[]=[],calendar:object[]=[],foodVersions:{athleteId:string;week:number;knownAt:string;foods:Record<string,number|null>[]}[]=[]
 for(const athleteId of ['adult-a','adult-b'])for(let week=1;week<=6;week++){
  const first=(week-1)*7,day=date(first),runFact=run(`${athleteId}-run-${week}`,[week===3?1650:1500],week===3?4800:5000,day)
  facts.push({...runFact,athleteId})
  const liftDay=date(first+2),lift=training({id:`${athleteId}-strength-${week}`,sourceRecordId:`${athleteId}-strength-${week}`,occurrenceId:`${athleteId}-strength-${week}`,canonicalActivityId:`${athleteId}-strength-${week}`,athleteId,occurredAt:at(liftDay),knownAt:at(liftDay),receivedAt:at(liftDay),startedAt:at(liftDay),strengthSets:[set({loadKg:athleteId==='adult-a'?60:10,reps:5,rir:athleteId==='adult-a'?3:null})]})
  facts.push(lift)
  for(let d=0;d<(week===1?2:5);d++){
   const day=date(first+d),device=week>=5?'watch-b':'watch-a'
   facts.push({...measurement(`${athleteId}-hrv-${week}-${d}`,day,week===5&&d===2?null:week>=5?45:60,'RMSSD',device),athleteId})
   facts.push({...measurement(`${athleteId}-sleep-${week}-${d}`,day,week===3?5:8,'SLEEP','self'),athleteId})
  }
  calendar.push({athleteId,week,states:[{day,state:'RUN_COMPLETED'},{day:date(first+1),state:'KNOWN_REST'},{day:liftDay,state:'STRENGTH_COMPLETED'},{day:date(first+3),state:'NOT_RECORDED'},...(week===3?[{day:date(first+4),state:'PLANNED_NOT_COMPLETED',reason:'工作导致漏练'}]:[])],strengthExperience:athleteId==='adult-a'?'4 years':'beginner',tolerance:'NOT_ESTABLISHED',hostCalendarBinding:'NOT_VERIFIED'})
  foodVersions.push({athleteId,week,knownAt:at(day),foods:[{kcal:week===3?400:600,protein:week===1?null:20,carb:70,fat:null,fiber:null}]})
 }
 for(const athleteId of ['adult-a','adult-b']){
  const old=facts.find((f):f is TrainingFact=>f.kind==='TRAINING'&&f.id===`${athleteId}-run-3`)!
  facts.push({...old,id:old.id+'-correction',revision:2,knownAt:at(date(39)),receivedAt:at(date(39)),runSegments:[{...old.runSegments[0],distanceM:5000}]})
  foodVersions.push({athleteId,week:3,knownAt:at(date(39)),foods:[{kcal:800,protein:40,carb:140,fat:null,fiber:null}]})
 }
 const rows=[]
 for(let week=1;week<=6;week++)for(const athleteId of ['adult-a','adult-b']){
  const asOf=date((week-1)*7+6)+'T20:00:00Z',ctx={...context,athleteId,asOf},visibleFoods=foodVersions.filter(f=>f.athleteId===athleteId&&f.knownAt<=asOf)
  const foods=new Map<number,typeof foodVersions[number]>();for(const f of visibleFoods)foods.set(f.week,f)
  const options:R4ReviewOptions={tasks:['baseline','capability','nutrition'],population:'unknown',foods:[...foods.values()].flatMap(f=>f.foods)}
  const result=projectReview('分项能力、个人基线与记录完整性',facts,options,ctx)
  assert.deepEqual(result,projectReview('分项能力、个人基线与记录完整性',facts,options,ctx))
  assert.ok(result.review.capability.running.records.every(r=>r.ref.id.startsWith(athleteId)))
  assert.equal(result.review.capability.overallScore,null)
  assert.equal(result.review.nutrition.energyDeficit,null)
  assert.ok(result.review.baselines.every(b=>b.provisional))
  if(week>=5)assert.equal(new Set(result.review.baselines.filter(b=>b.metric==='RMSSD').map(b=>b.device)).size,2)
  if(week<6)assert.ok(result.visibleRefs.every(r=>!r.id.endsWith('correction')))
  if(week===6){assert.ok(result.visibleRefs.some(r=>r.id===`${athleteId}-run-3-correction`));assert.ok(!result.visibleRefs.some(r=>r.id===`${athleteId}-run-3`));assert.equal(calc(result,'RUN_DISTANCE_M',`${athleteId}-run-3-correction`),5000)}
  rows.push({athleteId,week,asOf,calendar:calendar.find((c:any)=>c.athleteId===athleteId&&c.week===week),result,verdict:'DETERMINISTIC_BOUNDARIES_CHECKED',notAccepted:['calendar UI binding','persistent hypothesis withdrawal','plan rescheduling','professional recommendation']})
 }
 return {provenance:'PUBLIC_SYNTHETIC',facts,foodVersions,rows,modelCalls:0,userStoreWrites:0,fullAppAcceptance:false}
}

export function demonstrations(){
 const old=run('run',[180],1000,'2026-10-15'),corrected={...old,id:'run-corrected',revision:2,knownAt:at('2026-10-22'),receivedAt:at('2026-10-22'),runSegments:[{...old.runSegments[0],durationSeconds:210}]}
 const before=projectReview('跑步比较',[old]),after=projectReview('跑步更正后比较',[old,corrected])
 assert.equal(calc(before,'RUN_WORK_SECONDS'),180);assert.equal(calc(after,'RUN_WORK_SECONDS'),210);assert.notEqual(before.inputRevision,after.inputRevision)
 const mixedRun=run('mixed-run',[30,31],200),mixedStrength=training({id:'mixed-strength',sourceRecordId:'mixed-strength',occurrenceId:mixedRun.occurrenceId,canonicalActivityId:mixedRun.canonicalActivityId,strengthSets:[set({id:'s1',loadKg:20,reps:8}),set({id:'s2',loadKg:20,reps:8})]})
 const mixed=projectReview('同一天跑步和力量的冲突',[mixedRun,mixedStrength])
 assert.equal(calc(mixed,'OCCURRENCE_COUNT'),1);assert.equal(calc(mixed,'STRENGTH_EXTERNAL_VOLUME_KG_REPS'),320)
 const foodBefore=projectReview('只问饮食',[],{foods:[{kcal:400,protein:null}]}),foodAfter=projectReview('只问饮食',[],{foods:[{kcal:400,protein:25}]})
 assert.equal(foodBefore.review.nutrition.protein.status,'PARTIAL');assert.equal(foodAfter.review.nutrition.protein.knownSum,25)
 assert.equal(foodAfter.review.nutrition.energyDeficit,null)
 return {kind:'DETERMINISTIC_COMPONENT_DEMONSTRATIONS',browserEndToEndAccepted:false,runningCorrection:{before,after},sameOccurrenceRunningStrength:mixed,nutritionCompletion:{before:foodBefore,after:foodAfter},notCovered:['user editing UI','real storage acknowledgement','asynchronous UI update']}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const index=process.argv.indexOf('--output'),out=index>=0?process.argv[index+1]:null
 if(!out)throw Error('Usage: --output existing-or-new-review-directory')
 mkdirSync(out,{recursive:true})
 for(const [name,result] of [['teaching-20',teachingReplay()],['six-week-two-athletes',sixWeekReplay()],['three-demonstrations',demonstrations()]] as const)writeFileSync(resolve(out,name+'.json'),JSON.stringify(result,null,2))
 console.log('20 teaching projections, 12 weekly projections and 3 component demonstrations recorded; full app acceptance NOT passed.')
}
