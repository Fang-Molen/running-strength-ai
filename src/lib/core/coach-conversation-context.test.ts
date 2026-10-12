import test from 'node:test'; import assert from 'node:assert/strict';
import {extractConversationContext, contextualFollowup} from './coach-conversation-context.ts';
test('multi-turn event time GI context',()=>{
 const h=[{role:'user',text:'我明天跑1500米'},{role:'coach',text:'好的'},{role:'user',text:'早上7点开始'},{role:'user',text:'我之前赛前胃不舒服'}];
 const c=extractConversationContext(h,'我早餐吃什么');
 assert.equal(c.event,'1500米'); assert.equal(c.startTime,'07:00'); assert.equal(c.gastrointestinalConcern,true);
 const a=contextualFollowup('我早餐吃什么',c)!;
 assert.match(a,/1500米/); assert.match(a,/07:00/); assert.doesNotMatch(a,/还需要：开赛时间/);
});
test('do not mistake ordinary numeric results for start time',()=>{
 const c=extractConversationContext([{role:'user',text:'我跑1500米成绩4:10'}],'吃什么');
 assert.equal(c.startTime,null); assert.equal(c.event,'1500米');
});
test('do not infer medical symptoms from negation',()=>{
 assert.equal(extractConversationContext([], '我没有胃不舒服，赛前吃什么').gastrointestinalConcern,false)
});
test('does not inject context into unrelated question',()=>{
 assert.equal(contextualFollowup('分析今天的跑步',extractConversationContext([], '分析今天的跑步')),null)
});
