import assert from 'node:assert/strict';
import test from 'node:test';
import { SPORT_DOCUMENTS, SPORT_SOURCES, searchSportKnowledge } from './knowledge-catalog.ts';
import { answerLearningQuestion, learningQuestion, sportSourceReadLabel } from './knowledge-presentation.ts';

test('progressive browsing reaches every course and every catalogue item beyond 60',()=>{
  for(const kind of ['lesson','all'] as const){
    let shown=0;
    const total=searchSportKnowledge({kind}).total;
    for(let limit=8;limit<total+8;limit+=8){
      const page=searchSportKnowledge({kind,limit});
      assert.ok(page.items.length>shown,`${kind} stalled at ${shown}`);
      assert.equal(new Set(page.items.map(d=>d.id)).size,page.items.length);
      shown=page.items.length;
    }
    assert.equal(shown,total);
  }
});
test('offset pagination covers the same complete collection without overlap',()=>{
  const all=searchSportKnowledge({kind:'all',limit:1000});
  const ids=[];
  for(let offset=0;offset<all.total;offset+=8)ids.push(...searchSportKnowledge({kind:'all',limit:8,offset}).items.map(d=>d.id));
  assert.deepEqual(ids,all.items.map(d=>d.id));
  assert.equal(searchSportKnowledge({kind:'all',offset:all.total}).items.length,0);
});
test('every source has a human-readable verification label and literature contains no status codes',()=>{
  for(const source of SPORT_SOURCES){
    const label=sportSourceReadLabel(source.readLevel);
    assert.notEqual(label,'核验范围待补充',source.readLevel);
    assert.match(label,/[\u4e00-\u9fff]/);
    assert.ok(!label.includes('_'));
  }
  for(const doc of SPORT_DOCUMENTS.filter(d=>d.kind==='literature'))assert.doesNotMatch(doc.body,/[A-Z]{3,}_[A-Z_]+/);
  assert.equal(sportSourceReadLabel('FUTURE_UNKNOWN_STATUS'),'核验范围待补充');
});
test('library questions resolve to the chosen article and its actual limits and source',()=>{
  for(const doc of SPORT_DOCUMENTS){
    const answer=answerLearningQuestion(learningQuestion(doc));
    assert.ok(answer,doc.id);
    assert.ok(answer.includes(doc.title));
    assert.ok(answer.includes(doc.body));
    assert.ok(answer.includes(doc.limits));
    assert.match(answer,/不能据此判断你已恢复、批准加量或修改课表/);
    if(doc.kind==='research-note')assert.match(answer,/待专业审核/);
  }
});
test('personal edits and safety questions never bypass the normal coach pipeline',()=>{
  const q=learningQuestion(SPORT_DOCUMENTS[0]);
  for(const value of ['', '我今天胸痛还能跑吗', q+'我胸痛，是否继续跑？',q.replace('适用范围','我的今日训练量'),q.replace('EDU001','EDU999')]){
    assert.equal(answerLearningQuestion(value),null,value);
  }
  assert.ok(answerLearningQuestion('  '+q+'  '));
});
