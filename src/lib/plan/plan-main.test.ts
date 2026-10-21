import test from 'node:test';
import assert from 'node:assert/strict';
import { mainTrainingLines } from './plan-main';
import { planFor, v4RecordLine } from '../coach/plain-coach';
import { PLAN_DOC_KEY } from './active-plan';
import { plan400TodayEntry } from '../ui/plan400-start';
const day=(date:string,main:string[])=>({date,orig:date,weekday:'',week:'1',title:'间歇跑',main,aux:[],strength:[]});
const store=(days:ReturnType<typeof day>[],tag='测试')=>({getItem:(key:string)=>key===PLAN_DOC_KEY?JSON.stringify({schema:'fangkun-plan-v1',tag,plan:{name:'合成验证计划',shiftDays:0,weeks:[],days}}):key==='fk-plan400-v4-log'?JSON.stringify({'2026-10-22':{done:'done',rpe:'5'}}):null});

test('one-line and multi-line imported training preserve the first actual instruction',()=>{
 for(const main of [['轻松跑20分钟'],['4×200米，组间休息90秒','放松跑10分钟'],['主课：4×200米','观察：疼痛时停止']]){
  assert.deepEqual(mainTrainingLines({main}),main);
 }
});
test('only an exact decorative heading is omitted and the original document is never mutated',()=>{
 const main=['主课：','4×200米，休息90秒'];
 const output=mainTrainingLines({main});assert.deepEqual(output,[main[1]]);
 output[0]='changed';assert.deepEqual(main,['主课：','4×200米，休息90秒']);
 assert.deepEqual(mainTrainingLines({main:[]}),[]);
});
test('next session is the nearest future date even when imported days are unsorted',()=>{
 const days=[day('2026-10-25',['轻松跑25分钟']),day('2026-10-22',['轻松跑20分钟']),day('2026-10-21',['4×200米'])];
 const before=JSON.stringify(days); const result=planFor('2026-10-21',store(days));
 assert.match(result.today!,/4×200米/);assert.match(result.next!,/2026-10-22.*轻松跑20分钟/);assert.equal(JSON.stringify(days),before);
});
test('explicit caller store supplies both plan and record labels without reading another device plan',()=>{
 const a=store([day('2026-10-22',['3×300米'])],'甲'),b=store([day('2026-10-22',['5×100米'])],'乙');
 assert.match(planFor('2026-10-22',a).today!,/3×300米/);assert.match(planFor('2026-10-22',b).today!,/5×100米/);
 assert.match(v4RecordLine('2026-10-22',b)!,/^乙 计划记录/);
});
test('a single main line produces an executable plan entry instead of disappearing',()=>{
 const entry=plan400TodayEntry(day('2026-10-22',['200米×4，组间90秒']), null, () => ({unit:'reps',perSide:false}));
 assert.ok(entry);
 assert.ok(JSON.stringify(entry).includes('200'));
});
