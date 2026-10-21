import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const source=readFileSync(fileURLToPath(new URL('../../components/learning-library.tsx',import.meta.url)),'utf8');
const sheet=readFileSync(fileURLToPath(new URL('../../components/coach-sheet.tsx',import.meta.url)),'utf8');
test('learning tab mounts real sports knowledge browser, not internal curriculum',()=>{
  assert.match(sheet,/LearningLibrary/);
  assert.match(source,/searchSportKnowledge/);
  assert.match(source,/SPORT_LIBRARY_COUNTS/);
  assert.doesNotMatch(source,/coach-curriculum-data/);
});
test('external reference links obey the existing network authorization prop',()=>{
  assert.match(source,/publicReferencesAllowed\?/);
  assert.match(source,/href=\{source.url\}/);
  assert.match(source,/rel="noopener noreferrer"/);
});
test('UI displays source provenance and research pending labels',()=>{
  assert.match(source,/来源与核验范围/);
  assert.match(source,/待专业审核/);
  assert.match(source,/不等于你的个人训练处方/);
  assert.match(source,/没有找到匹配内容/);
});
