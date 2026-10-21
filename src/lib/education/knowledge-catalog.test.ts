import assert from 'node:assert/strict';
import test from 'node:test';
import { SPORT_DOCUMENTS, SPORT_LIBRARY_COUNTS, SPORT_SOURCES, findSportSource, searchSportKnowledge } from './knowledge-catalog.ts';

test('learning content enriched with authored courses and existing sources',()=>{
  assert.equal(SPORT_LIBRARY_COUNTS.lessons,61);
  assert.ok(SPORT_LIBRARY_COUNTS.researchNotes>=25);
  assert.ok(SPORT_LIBRARY_COUNTS.literature>=12);
  assert.ok(SPORT_SOURCES.length>=12);
});
test('exclude internal AI collaboration and reasoning sources from public knowledge',()=>{
  assert.ok(SPORT_DOCUMENTS.every(d=>!d.title.includes('AI协作')&&!d.title.includes('知识版本核对')));
  assert.ok(SPORT_SOURCES.every(s=>!['S13','S14','S15','S16'].includes(s.id)));
});
test('candidate notes remain pending, never prescription-authorized',()=>{
  assert.ok(SPORT_DOCUMENTS.every(d=>d.personalPrescription===false));
  assert.ok(SPORT_DOCUMENTS.filter(d=>d.kind==='research-note').every(d=>d.reviewStatus==='RESEARCH_PENDING'));
});
test('all displayed references have valid HTTPS URLs',()=>{
  for(const d of SPORT_DOCUMENTS)for(const id of d.sourceIds){
    const s=findSportSource(id);assert.ok(s,`missing ${id}`);assert.match(s!.url,/^https:\/\//);
  }
});
test('keyword search supports track, strength, sleep and shorthand',()=>{
  for(const q of ['800米','深蹲','午睡','HRV','422','1234321']){
    assert.ok(searchSportKnowledge({query:q,kind:'all'}).total>0,q);
  }
});
test('filtering, pagination, query normalization, and no result are stable',()=>{
  const a=searchSportKnowledge({category:'track',kind:'lesson',limit:2});
  const b=searchSportKnowledge({category:'track',kind:'lesson',limit:2,offset:2});
  assert.equal(a.items.length,2);assert.equal(b.items.length,2);assert.notEqual(a.items[0].id,b.items[0].id);
  assert.equal(searchSportKnowledge({query:'不存在词条XYZ!!!',kind:'all'}).total,0);
  assert.ok(searchSportKnowledge({query:'ＨＲＶ',kind:'all'}).total>0);
});
test('research source records remain available without modifying user data',()=>{
  const r=searchSportKnowledge({query:'sprint',kind:'literature'});
  assert.ok(r.total>0);
  assert.ok(r.items.every(x=>x.reviewStatus==='SOURCE_INDEX'));
});

test('modern sports references are indexed with original URLs and explicit boundaries',()=>{
  for(const id of ['MOD2026ACSM','MOD2023REDS','MOD2021SLEEP','MOD2016LOAD','MOD2017PROTEIN','MOD2024PSYCH']){
    const source=findSportSource(id);assert.ok(source,id);
    assert.equal(source!.provenance,'VERIFIED_PUBLIC_SUMMARY');
    assert.ok(source!.limits.length>10);
    assert.ok(SPORT_DOCUMENTS.some(d=>d.sourceIds.includes(id)));
  }
});
test('expanded educational lessons cover major sports-science domains',()=>{
  for(const category of ['strength','recovery','nutrition','principles','track','technique'] as const){
    assert.ok(SPORT_DOCUMENTS.filter(d=>d.kind==='lesson'&&d.category===category).length>=4,category);
  }
  assert.ok(searchSportKnowledge({query:'力竭',kind:'all'}).total>0);
  assert.ok(searchSportKnowledge({query:'REDs',kind:'all'}).total>0);
  assert.ok(searchSportKnowledge({query:'2026 ACSM',kind:'all'}).total>0);
});
