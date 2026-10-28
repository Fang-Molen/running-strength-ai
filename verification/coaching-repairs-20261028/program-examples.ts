/** Run unchanged against both git 8c1d4b6 and the current tree. Synthetic only. */
import { pathToFileURL } from 'node:url';
const root=process.cwd();
const mod=(file:string)=>import(pathToFileURL(root+'/'+file).href);
const {mergeActivities,applyV4Fact,activityWeeks}=await mod('src/lib/ui/training-read-model.ts');
const {v4DayFact}=await mod('src/lib/ui/plan400-view.ts');
const {fmtPace}=await mod('src/lib/ui/activity-format.ts');
const {onlineContextNeeds,selectOnlineContext}=await mod('src/lib/coach/online-context.ts');
const {digestCoachAnswer}=await mod('src/lib/ui/coach-answer-digest.ts');
const {cycleFixture}=await mod('src/lib/coach/cycle/fixtures.ts');
const {buildAthletePortrait}=await mod('src/lib/coach/cycle/portrait.ts');
const {parseR5Intent}=await mod('src/lib/coach/r5/intents.ts');
const {projectAnalysisEvidence}=await mod('src/lib/health/analysis-evidence.ts');
const {buildMuscleExposure}=await mod('src/lib/health/muscle-exposure.ts');
const {evaluateRecoveryEvidence}=await mod('src/lib/health/recovery-assessment.ts');
const {buildCoachAnalysisPacket}=await mod('src/lib/health/analysis-packet.ts');
const day='2026-10-28',asOf=day+'T10:00:00Z';
const row={id:'import:A',originIds:['import:A'],source:'import',date:day,startedAt:day+'T08:00:00Z',sport:'RUNNING',distanceM:6010,durationSec:1611.94,strengthVolumeKg:null,sets:null,rpe:null};
const [merged]=mergeActivities([row,{...row,id:'garmin:A',originIds:['garmin:A','import:A'],source:'garmin'}]);
applyV4Fact(merged,{...v4DayFact({date:day,orig:day,weekday:'三',week:'1',title:'合成跑步',main:['轻松跑'],aux:[],strength:[]},undefined,{runLinked:true}),date:day});
const input=cycleFixture();input.goal.runningExperience='TRAINED';input.goal.strengthExperience='NOVICE';input.snapshot.context.asOf=asOf;
const snapshot=projectAnalysisEvidence({context:input.snapshot.context,facts:[input.snapshot.facts[0]]}),exposure=buildMuscleExposure(snapshot),question='这次训练怎么样';
const packet=buildCoachAnalysisPacket(snapshot,evaluateRecoveryEvidence(snapshot,exposure),exposure,{question});
const context=selectOnlineContext({owner:snapshot.context.athleteId,question,day,asOf,facts:snapshot.facts,packet,selectedTrainingIds:[snapshot.facts[0].occurrenceId],conversation:[{role:'user',text:'这节跑步怎么样？'}]}).context;
console.log(JSON.stringify({synthetic:true,actualModel:false,professionalReview:false,cases:[
 {id:'X01',input:'同一活动的导入和手表来源，各6.01km/1611.94s，关联V4',output:{durationSeconds:merged.durationSec,pace:fmtPace(merged.distanceM,merged.durationSec),weeklyMinutes:activityWeeks([merged],day,1)[0].minutes}},
 {id:'X02',input:question,output:onlineContextNeeds(question)},
 {id:'X03',input:'所选训练+代码分析+近期对话',output:{categories:context.records.map((r:{category:string})=>r.category),computedMetrics:context.records.flatMap((r:{category:string;fields:{name:string;value:unknown}[]})=>r.category==='ANALYSIS'?r.fields.filter(f=>f.name==='metric').map(f=>f.value):[]),coverage:context.coverage}},
 {id:'X07',input:'**结论：这次训练节奏稳定。仍需观察次日反馈。**\n下一课：确认恢复后再安排。',output:digestCoachAnswer('**结论：这次训练节奏稳定。仍需观察次日反馈。**\n下一课：确认恢复后再安排。')},
 {id:'C01',input:'分别确认跑步有经验、力量新手',output:buildAthletePortrait(input).experience},
 {id:'J01',input:'把明天的强度课改成轻松跑',output:parseR5Intent('把明天的强度课改成轻松跑',asOf)},
 ]},null,2));
