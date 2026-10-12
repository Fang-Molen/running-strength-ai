import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const hub=read('src/components/coach-coordination-hub.tsx');
const sheet=read('src/components/coach-sheet.tsx');
const local=read('src/lib/core/coach-local-first.ts');
test('read-only science path appears on AI hub',()=>{
  assert.match(hub,/训练刺激.*身体响应.*恢复与适应.*专项表现/s);
  assert.match(hub,/不等于已确认你的个人适应/);
});
test('two example questions go to editable draft, not directly online',()=>{
  assert.match(sheet,/理解间歇原理/);
  assert.match(sheet,/力量如何迁移/);
  assert.match(sheet,/onClick=\{\(\) => setDraft\("为什么相同的400米/);
});
test('existing answerLocally uses shared mechanism, preserving safety branch ordering',()=>{
  assert.match(local,/explainTrainingMechanism/);
  assert.ok(local.indexOf('if (danger ||') < local.indexOf('else if (mechanism)'));
});
test('no health data or storage mutation in new hub text',()=>{
  assert.doesNotMatch(hub,/savePlan\(|localStorage|fetch\(|askCoach\(/);
});
