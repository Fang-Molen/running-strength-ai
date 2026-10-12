import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainTrainingMechanism, formatTrainingMechanism } from './coach-training-mechanisms.ts';
import { answerLocally } from './coach-local-first.ts';

const brief = {question:'', occurrenceId:null, sources:[],sourceIds:[],sessionRpe:null,sleepHours:null,subjectiveRecovery:null,completedSetCount:null,plannedSetCount:null,pain:false,mustAsk:[], runningStructure:'UNAVAILABLE' as const,recoveryState:null,fatigueState:null,duplicateCount:0,repetitionSlots:0,continuousCount:0,durationSec:null,daysToCompetition:null,week:null,bias:null, constraints:{medicalReferral:false,increaseBlocked:false,blockReason:null}};
const questions = [
  ['为什么相同的400米×8，组间休息1分钟和8分钟训练刺激不同？','INTERVAL_RECOVERY'],
  ['为什么深蹲力量提升，不一定提高400米跑步成绩？','STRENGTH_TRANSFER'],
  ['上午60米冲刺下午深蹲5×5，会不会疲劳叠加？','CONCURRENT_STRESS'],
  ['为什么轻松跑40分钟和60米冲刺训练刺激不同？','STIMULUS_SPECIFICITY'],
  ['训练的本质是什么？神经肌肉和心肺呼吸系统如何联系？','GENERAL_ADAPTATION'],
] as const;
for (const [question, kind] of questions) {
  test(`cross-training mechanism ${kind}`,()=>{
    const result = explainTrainingMechanism(question);
    assert.equal(result?.kind,kind);
    assert.ok(result?.missingEvidence.length);
    assert.match(formatTrainingMechanism(result!),/UNKNOWN/);
    assert.doesNotMatch(formatTrainingMechanism(result!),/应该增加20%|保证提升|已确认你/);
  });
  test(`local question answers ${kind} without automatic decisions`,()=>{
    const a=answerLocally({...brief,question} as Parameters<typeof answerLocally>[0]);
    assert.match(a.text,/事实与概念|训练共通原理/);
    assert.match(a.text,/个人适应结论：UNKNOWN/);
    assert.match(a.text,/没有修改计划或记录/);
  });
}
test('unrelated and underspecified requests are not guessed',()=>{
  assert.equal(explainTrainingMechanism('跑了400米'),null);
  assert.equal(explainTrainingMechanism('今天吃什么'),null);
  assert.equal(explainTrainingMechanism('400米×8'),null);
});
test('urgent symptoms keep local safety priority over mechanism explanation',()=>{
  const a=answerLocally({...brief,question:'我现在胸痛，为什么深蹲训练影响400米跑步？'} as Parameters<typeof answerLocally>[0]);
  assert.match(a.text,/紧急评估|急诊/);
  assert.doesNotMatch(a.text,/个人适应结论：UNKNOWN/);
});
test('health constraints are retained with mechanism explanation',()=>{
  const a=answerLocally({...brief,question:'为什么深蹲提高不一定让400米跑步更快',pain:true} as Parameters<typeof answerLocally>[0]);
  assert.match(a.text,/不建议.*加量/);
});
