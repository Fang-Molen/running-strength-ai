import test from 'node:test'
import assert from 'node:assert/strict'
import {assessCoachQuestion} from './coach-question-reasoning.ts'
import {advanceAthleteDialogue,emptyAthleteDialogueState} from './coach-athlete-dialogue.ts'
const cases:[string,string,string][]=[
 ['否定胸痛','今天没有胸痛','NONE'],
 ['否定晕厥','没有晕厥','NONE'],
 ['混合否定和肯定','没有胸痛，但是跑步时晕厥了','EMERGENCY'],
 ['后句阳性','我没有晕厥，但是运动中胸痛','EMERGENCY'],
 ['正在胸痛','跑步时胸痛','EMERGENCY'],
 ['运动突然头晕','运动时突然头晕','EMERGENCY'],
 ['旧症已评估','去年胸痛，已经完成医学评估，现在没有症状','NONE'],
 ['跟腱疼','跑完跟腱疼痛','MEDICAL_REVIEW'],
 ['应力性骨折','医生怀疑应力性骨折','MEDICAL_REVIEW'],
 ['训练普通问答','800米间歇训练怎么安排','NONE'],
 ['营养普通问答','长跑碳水摄入如何安排','NONE'],
 ['设备误差','手表GPS数据不准','NONE'],
]
for(const [name,input,expected] of cases)test(name,()=>assert.equal(assessCoachQuestion(input).safety,expected))
test('不把PB换算冒充当前预测',()=>{
 let r=advanceAthleteDialogue(emptyAthleteDialogueState(),'我5000米PB是16分00秒')
 assert.equal(r.historical3000EquivalentSeconds!==null,true)
 r=advanceAthleteDialogue(r.state,'停训半年了，现在3000米能跑多少')
 assert.equal(r.predictionStatus,'HISTORICAL_EQUIVALENT_ONLY')
 assert.equal(r.state.recentTrainingStatus,'INTERRUPTED')
 assert.equal(r.assessment.decisionAuthorization,false)
})
test('急症禁止输出历史等效成绩',()=>{
 let r=advanceAthleteDialogue(emptyAthleteDialogueState(),'我5000米PB是16分00秒')
 r=advanceAthleteDialogue(r.state,'运动中胸痛')
 assert.equal(r.historical3000EquivalentSeconds,null)
 assert.equal(r.predictionStatus,'INSUFFICIENT_CURRENT_EVIDENCE')
})
