import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyLocalSafety } from './coach-local-safety.ts'
const cases: [string, 'EMERGENCY'|'MEDICAL_REVIEW'|'NONE'][] = [
 ['我跑步时胸痛','EMERGENCY'],['刚刚晕厥了','EMERGENCY'],['现在喘不过气','EMERGENCY'],['训练后尿色像可乐','EMERGENCY'],['今天严重头晕','EMERGENCY'],
 ['我没有胸痛','NONE'],['去年胸痛过现在没有','MEDICAL_REVIEW'],['以前晕厥过，想了解原因','MEDICAL_REVIEW'],
 ['血红蛋白偏低怎么办','MEDICAL_REVIEW'],['铁蛋白很低吃什么','MEDICAL_REVIEW'],['我能自己吃补铁剂吗','MEDICAL_REVIEW'],['经期紊乱还要减脂吗','MEDICAL_REVIEW'],['应力性骨折后恢复','MEDICAL_REVIEW'],['我持续疲劳','MEDICAL_REVIEW'],['怀疑RED-S','MEDICAL_REVIEW'],
 ['明天1500米赛前怎么吃','NONE'],['今天力量训练后补蛋白','NONE'],['双阈值训练是什么','NONE'],['4mmol是不是LT2','NONE'],['5000米配速怎么算','NONE'],
]
for (const [question, expected] of cases) test(question,()=>assert.equal(classifyLocalSafety(question),expected))
