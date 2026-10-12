import fs from 'node:fs';
const dir=new URL('./',import.meta.url);
const cases=JSON.parse(fs.readFileSync(new URL('athlete-300-results.json',dir)));
// GPT-authored semantic reference rubric: independent of the runtime classifier, not a clinical gold standard.
const domainIntent={'训练设计':'TRAINING_DESIGN','力量迁移':'PERFORMANCE_TRANSFER','训练监测':'DATA_INTERPRETATION','营养补给':'NUTRITION','比赛战术':'RACE_STRATEGY','心理状态':'PSYCHOLOGY','环境适应':'ENVIRONMENT','研究证据':'EVIDENCE','模型自检':'META','历史成绩':'PERFORMANCE_TRANSFER','否定症状':'SAFETY','当前急症':'SAFETY','伤病症状':'SAFETY','复杂混合':'SAFETY','训练数据解释':'DATA_INTERPRETATION'};
const exceptions={C269:'PSYCHOLOGY',C273:'DATA_INTERPRETATION',C281:'DATA_INTERPRETATION',C285:'DATA_INTERPRETATION',C289:'DATA_INTERPRETATION',C293:'DATA_INTERPRETATION',C297:'DATA_INTERPRETATION',C201:'UNKNOWN',C205:'TRAINING_DESIGN',C209:'UNKNOWN',C213:'UNKNOWN',C217:'UNKNOWN'};
const base=cases.filter(x=>x.variant===0);
const ref=new Map(base.map(x=>[Math.floor((Number(x.id.slice(1))-1)/4),exceptions[x.id]||domainIntent[x.domain]]));
const reviewed=cases.map(x=>({...x,referenceIntent:ref.get(Math.floor((Number(x.id.slice(1))-1)/4)),intentAgreement:x.brain.intent===ref.get(Math.floor((Number(x.id.slice(1))-1)/4)),reviewKind:x.variant===0?'GPT_AUTHORED_BASE_RUBRIC':'PROPAGATED_VARIANT_RUBRIC'}));
const mismatches=reviewed.filter(x=>!x.intentAgreement);
const out={total:reviewed.length,baseRubrics:base.length,variantsPropagated:reviewed.length-base.length,intentAgreements:reviewed.length-mismatches.length,intentMismatches:mismatches.length,baseAgreement:reviewed.filter(x=>x.variant===0&&x.intentAgreement).length,baseTotal:base.length,byDomain:Object.fromEntries([...new Set(reviewed.map(x=>x.domain))].map(d=>[d,{total:reviewed.filter(x=>x.domain===d).length,mismatch:reviewed.filter(x=>x.domain===d&&!x.intentAgreement).length}])),mismatchExamples:mismatches.filter(x=>x.variant===0).map(x=>({id:x.id,question:x.question,actual:x.brain.intent,reference:x.referenceIntent}))};
fs.writeFileSync(new URL('athlete-300-review.json',dir),JSON.stringify(reviewed,null,2));fs.writeFileSync(new URL('athlete-300-review-summary.json',dir),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
