import {assessCoachQuestion} from '../src/lib/core/coach-question-reasoning.ts';
import fs from 'node:fs';
const cases=[
['我刚跑完突然胸口压榨样疼痛','EMERGENCY'],['没有胸痛，但刚刚晕厥了','EMERGENCY'],['跑步时喘不上气','EMERGENCY'],['我现在呼吸困难','EMERGENCY'],['去年胸痛现在完全没症状','NONE'],['今天没有胸痛','NONE'],['跑步后跟腱疼痛','MEDICAL_REVIEW'],['怀疑应力性骨折','MEDICAL_REVIEW'],['我膝盖肿起来了','CAUTION'],['我没有膝盖肿胀','NONE'],['跑步时小腿疼','MEDICAL_REVIEW'],['我没有疼痛想跑步','NONE'],['训练后出现晕倒','EMERGENCY'],['我最近贫血能练吗','MEDICAL_REVIEW'],['上次骨折已经康复还能跑吗','MEDICAL_REVIEW'],['脚踝扭伤了','MEDICAL_REVIEW'],['昨天跑步头晕今天还头晕','EMERGENCY'],['我训练时心脏疼','EMERGENCY'],['只是担心比赛失败','NONE'],['跑完跟腱不舒服','CAUTION'],['最近跑步时眼前一黑','EMERGENCY'],['我否认晕厥','NONE'],['今天胸口不痛','NONE'],['过去曾有晕厥现在无症状','NONE'],['跑步时气短而且胸闷','EMERGENCY'],['今天没有任何不适','NONE'],['连续几天足底疼','MEDICAL_REVIEW'],['昨天跑后脚踝明显肿','CAUTION'],['最近800米训练配速怎么安排','NONE'],['5000米PB16分钟预测3000米','NONE']
];
const results=cases.map(([q,expected],i)=>{const a=assessCoachQuestion(q);return {id:i+1,q,expected,actual:a.safety,pass:expected===a.safety}});
fs.writeFileSync('scenarios/unseen-v5-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({total:results.length,pass:results.filter(x=>x.pass).length,failures:results.filter(x=>!x.pass)},null,2));
