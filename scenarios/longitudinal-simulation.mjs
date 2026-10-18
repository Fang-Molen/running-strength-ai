import {writeFileSync} from 'node:fs';
import {emptyAthleteDialogueState,advanceAthleteDialogue} from '../src/lib/core/coach-athlete-dialogue.ts';
const cases=[
 {id:'L01',turns:['我是中长跑选手','5000米PB是16分00秒','请预测3000米'],expect:{type:'MIDDLE_LONG_DISTANCE',pb:960,equivalent:true}},
 {id:'L02',turns:['我两年前5000米PB是16分00秒','我停训半年','现在3000米能跑多少'],expect:{age:'HISTORICAL',interrupted:true,equivalent:true}},
 {id:'L03',turns:['我今天5000米训练目标16分00秒','请预测3000米'],expect:{pbCount:0,equivalent:false}},
 {id:'L04',turns:['5000米PB是16分00秒','运动中突然胸痛，我能继续跑吗'],expect:{safety:'EMERGENCY',equivalent:false}},
 {id:'L05',turns:['我今天没有胸痛，也没有晕厥','我5000米PB是16分00秒'],expect:{pb:960}},
];
const results=[];
for(const c of cases){let state=emptyAthleteDialogueState(),r;for(const utterance of c.turns){r=advanceAthleteDialogue(state,utterance);state=r.state;}
 const e=c.expect, checks=[];
 if(e.type)checks.push({name:'type',pass:state.athleteType===e.type});
 if(e.pb!==undefined)checks.push({name:'pb',pass:state.personalBests.find(x=>x.eventMeters===5000)?.seconds===e.pb});
 if(e.pbCount!==undefined)checks.push({name:'pbCount',pass:state.personalBests.length===e.pbCount});
 if(e.age)checks.push({name:'pbAge',pass:state.personalBests[0]?.age===e.age});
 if(e.interrupted)checks.push({name:'interrupted',pass:state.recentTrainingStatus==='INTERRUPTED'});
 if(e.safety)checks.push({name:'safety',pass:r.assessment.safety===e.safety});
 if(e.equivalent!==undefined)checks.push({name:'equivalent',pass:(r.historical3000EquivalentSeconds!==null)===e.equivalent});
 results.push({id:c.id,turns:c.turns,checks,finalState:state,assessment:{intent:r.assessment.intent,safety:r.assessment.safety},historicalEquivalent:r.historical3000EquivalentSeconds});
}
const total=results.reduce((a,x)=>a+x.checks.length,0),passed=results.reduce((a,x)=>a+x.checks.filter(y=>y.pass).length,0);
const report={total,passed,failed:total-passed,results};
writeFileSync('scenarios/longitudinal-results.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({total,passed,failed:total-passed}));if(total!==passed)process.exitCode=1;
