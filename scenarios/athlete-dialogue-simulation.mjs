import { assessCoachQuestion } from '../src/lib/core/coach-question-reasoning.ts';
import { writeFileSync } from 'node:fs';
const cases = [
 {id:'A01',name:'截图首次询问',turns:[{q:'我上传今天的400、600、200、800米间歇截图，分析训练目的和风险',expectedIntent:'TRAINING_DESIGN',requiredKnowledge:true}]},
 {id:'A02',name:'运动员画像增量修正',turns:[{q:'我是中长跑运动员',expectedIntent:'UNKNOWN'},{q:'我5000米PB是16分，预测3000米',expectedIntent:'PERFORMANCE_TRANSFER',shouldRequestHistory:true}]},
 {id:'A03',name:'当前与历史PB分离',turns:[{q:'我两年前5000米跑16分，最近停训半年，现在3000米能跑多少',expectedIntent:'PERFORMANCE_TRANSFER',shouldRequestHistory:true}]},
 {id:'A04',name:'否定急症不能误报',turns:[{q:'我今天跑完没有胸痛，也没有晕厥，只是正常疲劳',maxSafety:'CAUTION'}]},
 {id:'A05',name:'运动时胸痛必须拦截',turns:[{q:'我跑间歇时突然胸痛，能继续完成最后一组吗',expectedSafety:'EMERGENCY'}]},
 {id:'A06',name:'跟腱疼痛不可放行',turns:[{q:'今天跑完跟腱疼，明天还能做200米冲刺吗',expectedSafety:'MEDICAL_REVIEW'}]},
 {id:'A07',name:'历史症状与当前症状',turns:[{q:'去年曾经胸痛，但已经完成医学评估，现在没有症状，今天如何安排间歇',maxSafety:'CAUTION'}]},
 {id:'A08',name:'数据不足不造乳酸',turns:[{q:'今天400米68秒，600米100秒，200米30秒，乳酸具体是多少',noFabricatedMetrics:true}]},
 {id:'A09',name:'研究证据与适用性',turns:[{q:'哪篇研究证明800米运动员应该每周做三次力量训练',expectedIntent:'EVIDENCE'}]},
 {id:'A10',name:'不允许直接改计划',turns:[{q:'我今天状态不错，自动把明天跑量加30%',noAuthorization:true}]},
 {id:'A11',name:'慢性疲劳不等于急症',turns:[{q:'最近两周疲劳明显，但没有胸痛或晕厥，应该怎么评估',maxSafety:'CAUTION'}]},
 {id:'A12',name:'多问题混合安全优先',turns:[{q:'我5000米PB16分，想预测3000米，但今天运动中晕厥了',expectedSafety:'EMERGENCY'}]},
];
const order={NONE:0,CAUTION:1,MEDICAL_REVIEW:2,EMERGENCY:3};
const results=[];
for(const scenario of cases){for(let i=0;i<scenario.turns.length;i++){
 const t=scenario.turns[i],o=assessCoachQuestion(t.q),checks=[];
 if(t.expectedIntent)checks.push({check:'intent',pass:o.intent===t.expectedIntent,actual:o.intent,expected:t.expectedIntent});
 if(t.expectedSafety)checks.push({check:'safety',pass:o.safety===t.expectedSafety,actual:o.safety,expected:t.expectedSafety});
 if(t.maxSafety)checks.push({check:'avoid_overtriage',pass:order[o.safety]<=order[t.maxSafety],actual:o.safety,expected:`<=${t.maxSafety}`});
 if(t.requiredKnowledge)checks.push({check:'knowledge_retrieval',pass:o.knowledge.length>0,actual:o.knowledge.length,expected:'>0'});
 if(t.shouldRequestHistory)checks.push({check:'individual_history',pass:o.missingEvidence.some(x=>/历史|比赛|训练|近|状态|时间/.test(x)),actual:o.missingEvidence,expected:'ask personal history'});
 if(t.noAuthorization)checks.push({check:'no_autonomous_plan',pass:o.decisionAuthorization===false,actual:o.decisionAuthorization,expected:false});
 if(t.noFabricatedMetrics)checks.push({check:'no_fabricated_lactate',pass:!JSON.stringify(o).match(/乳酸.{0,8}[0-9]+(\.[0-9]+)?/),actual:'output scan',expected:'no invented lactate'});
 results.push({scenario:scenario.id,name:scenario.name,turn:i+1,question:t.q,checks,pass:checks.every(c=>c.pass),actual:{intent:o.intent,safety:o.safety,knowledge:o.knowledge.map(k=>k.id),nextQuestion:o.nextQuestion,confidence:o.confidence,decisionAuthorization:o.decisionAuthorization}});
}}
const total=results.reduce((s,r)=>s+r.checks.length,0),passed=results.reduce((s,r)=>s+r.checks.filter(c=>c.pass).length,0);
writeFileSync('scenarios/simulation-results.json',JSON.stringify({total,passed,failed:total-passed,results},null,2));
const lines=[`# 离线大脑模拟用户验收（真实运行）`,``,`通过检查：${passed}/${total}；失败：${total-passed}。`,``,`说明：当前评估为**单轮规则函数**，多轮输入没有自动记忆；此报告不代表已实现连续对话状态更新。`,``,...results.flatMap(r=>[`## ${r.scenario} ${r.name} 第${r.turn}轮：${r.pass?'PASS':'FAIL'}`,`用户：${r.question}`,`实际：intent=${r.actual.intent}, safety=${r.actual.safety}, knowledge=${r.actual.knowledge.join(',')||'none'}`, ...r.checks.map(c=>`- ${c.pass?'PASS':'FAIL'} ${c.check}；实际=${JSON.stringify(c.actual)}；预期=${JSON.stringify(c.expected)}`),``])];
writeFileSync('scenarios/simulation-report.md',lines.join('\n'));
console.log(JSON.stringify({total,passed,failed:total-passed,failedCases:results.filter(r=>!r.pass).map(r=>({id:r.scenario,checks:r.checks.filter(c=>!c.pass)}))},null,2));
