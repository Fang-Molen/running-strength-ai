import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRunningContext} from './running-context-exam.ts';
/** @type {{id:string,type:number,shape:string,ctx:import("./running-context-exam.ts").ExamContext}[]} */
const cases=[];
const shapes=['even','fade','fast','mixed'];
for(let i=0;i<100;i++){
 const shape=shapes[i%4],type=i%3;
 const d=type===2?[300,200,300,200,300,200]:Array(type===1?8:6).fill(type===1?200:400);
/** @type {import("./running-structured-context.ts").StructuredRep[]} */
 const reps=d.map((distanceMeters,j)=>({trainingOccurrenceId:'session-A',componentId:'run',blockId:'intervals',ordinal:j+1,round:type===1?Math.floor(j/4)+1:type===2?Math.floor(j/2)+1:1,step:type===1?j%4+1:type===2?j%2+1:j+1,sourceEventId:`event-${i}-${j}`,distanceMeters,seconds:shape==='even'?65:shape==='fade'?65+j:shape==='fast'?70-j:65+(j%2?1:-1),restAfterSeconds:90}));
 if(i%10===0)reps.push({...reps[0],trainingOccurrenceId:'session-B',sourceEventId:`foreign-${i}`});
 if(i%10===1)reps[0].seconds=null;
 if(i%10===2)reps[1].distanceMeters=null;
 if(i%10===3)reps[0].sourceEventId=reps[1].sourceEventId;
 if(i%10===4)reps[0].step=reps[1].step;
/** @type {import("./running-context-exam.ts").ExamContext} */
 const ctx={trainingOccurrenceId:'session-A',reps,goal:i%2?'EVEN':'PROGRESSIVE',pain:i%11===0,preRecovery:i%7===0?null:5,postRpe:i%9===0?null:7,nextSessionRequested:true};
 cases.push({id:`CASE-${String(i+1).padStart(3,'0')}`,type,shape,ctx});
}
for(const c of cases)test(c.id,()=>{
 const r=assessRunningContext(c.ctx);
 assert.equal(r.decision,'NONE');
 if(r.status==='OBSERVATION_ONLY'){
  assert.equal(r.causalFatigue,'UNKNOWN');assert.equal(r.nextSessionPrescription,null);
  if(c.type===2)assert.equal(r.deltaSeconds,null);
  if(c.ctx.pain)assert.equal(r.safety,'PAIN_REQUIRES_REVIEW');
  assert.equal(r.observation.excluded,c.ctx.reps.filter(x=>x.trainingOccurrenceId!=='session-A').length);
 }else assert.equal(r.status,'INSUFFICIENT_EVIDENCE');
});
test('missing occurrence fails closed',()=>assert.throws(()=>assessRunningContext({trainingOccurrenceId:'',reps:[]})));
test('no inferred fatigue despite slowing',()=>{const c=cases.find(x=>x.shape==='fade'&&x.type===0&&x.ctx.reps.every(r=>r.seconds!=null));const r=assessRunningContext(c?.ctx??{trainingOccurrenceId:"",reps:[]});assert.equal(r.causalFatigue,'UNKNOWN');assert.equal(r.decision,'NONE')});
