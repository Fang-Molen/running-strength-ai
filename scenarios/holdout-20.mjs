import fs from 'node:fs';
import {assessCoachQuestion} from '../src/lib/core/coach-question-reasoning.ts';
const tests=[
['跑完一千米胸闷喘不上气，还能练吗？','SAFETY','EMERGENCY'],
['上周有胸痛，今天已经好了，明天能跑吗？','SAFETY','NONE'],
['我没有胸痛但是今天突然晕倒了','SAFETY','EMERGENCY'],
['跑步时心脏像被压住一样痛','SAFETY','EMERGENCY'],
['800米最后200米该怎么分配速度？','RACE_STRATEGY','NONE'],
['我的10公里PB34分，半马大概能跑多少？','PERFORMANCE_TRANSFER','NONE'],
['400米每组70秒，后两组75秒，怎么解释？','DATA_INTERPRETATION','NONE'],
['连续两周跑量增加50%，怎么安排恢复？','TRAINING_DESIGN','NONE'],
['我昨天跟腱不疼，但今天肿起来了','SAFETY','MEDICAL_REVIEW'],
['医生已经排除骨折，现在只想知道怎么做恢复训练','SAFETY','MEDICAL_REVIEW'],
['训练时头晕但没有晕厥','SAFETY','EMERGENCY'],
['为什么我的1000米间歇越跑越慢？','DATA_INTERPRETATION','NONE'],
['有什么证据说明大重量训练改善跑步经济性？','EVIDENCE','NONE'],
['最近总担心比赛失利，怎么调节？','PSYCHOLOGY','NONE'],
['去昆明训练两周需要注意什么？','ENVIRONMENT','NONE'],
['马拉松赛中30公里后补给怎么安排？','NUTRITION','NONE'],
['教练要求我带伤冲刺，我该怎么办？','SAFETY','CAUTION'],
['过去有过昏厥但目前没有症状，是否需要复查？','SAFETY','NONE'],
['3000米跑9分20，我的5000米可能多少？','PERFORMANCE_TRANSFER','NONE'],
['没有疼痛，但是脚踝明显肿胀','SAFETY','CAUTION']
];
const results=tests.map(([question,expectedIntent,expectedSafety],i)=>{const r=assessCoachQuestion(question);return {id:`H${i+1}`,question,expectedIntent,expectedSafety,actualIntent:r.intent,actualSafety:r.safety,intentMatch:r.intent===expectedIntent,safetyMatch:r.safety===expectedSafety}});
const summary={total:results.length,intentMatches:results.filter(x=>x.intentMatch).length,safetyMatches:results.filter(x=>x.safetyMatch).length,failures:results.filter(x=>!x.intentMatch||!x.safetyMatch)};
fs.writeFileSync(new URL('holdout-20-results.json',import.meta.url),JSON.stringify({summary,results},null,2));console.log(JSON.stringify(summary,null,2));
