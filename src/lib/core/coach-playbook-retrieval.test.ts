import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PLAYBOOK_CONCEPTS} from './coach-playbook-concepts.ts'
import {PLAYBOOK_LESSONS,selectPlaybookLessons,buildPlaybookContext} from './coach-playbook.ts'
const rows=readFileSync(new URL('./__fixtures__/playbook-retrieval.jsonl',import.meta.url),'utf8').trim().split('\n').map(x=>JSON.parse(x))
test('R11 each handbook topic has at least twenty-five independently curated expressions',()=>{
 for(const lesson of PLAYBOOK_LESSONS)assert.ok(new Set(PLAYBOOK_CONCEPTS[lesson.id].flatMap(c=>c.synonyms)).size>=25,lesson.id)
})
test('R11 handbook self retrieval >=13/14',()=>assert.ok(PLAYBOOK_LESSONS.filter(l=>selectPlaybookLessons(l.question).some(x=>x.id===l.id)).length>=13))
test('R11 topic paraphrase benchmark >=280, top1 >=70%, top3 >=85%',()=>{
 assert.ok(rows.length>=280)
 for(const topic of PLAYBOOK_LESSONS)assert.ok(rows.filter(r=>r.expected===topic.id).length>=20)
 let top1=0,top3=0
 for(const row of rows){const ranked=selectPlaybookLessons(row.text);top1+=Number(ranked[0]?.id===row.expected);top3+=Number(ranked.some(r=>r.id===row.expected))}
 assert.ok(top1/rows.length>=.7,`top1 ${top1}/${rows.length}`);assert.ok(top3/rows.length>=.85,`top3 ${top3}/${rows.length}`)
})
test('R11 retrieval context fits the conservative 1200 token upper bound',()=>{
 for(const r of rows){const context=buildPlaybookContext(r.text);assert.ok(new TextEncoder().encode(JSON.stringify(context)).length<=1200);assert.ok(context.lessons.length>0)}
})
