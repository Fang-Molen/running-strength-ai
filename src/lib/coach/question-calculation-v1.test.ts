import test from 'node:test';
import assert from 'node:assert/strict';
import {questionCalculations} from './question-calculation';
const answer=(q:string,p:string[]=[])=>questionCalculations(q,p).map(x=>x.detail).join('\n');
test('ties do not choose the first runner as a winner',()=>{
 const s=answer('甲跑5公里25分钟，乙跑5公里25分钟。谁更快？');
 assert.match(s,/相同|并列/);assert.doesNotMatch(s,/甲.*较少、更快/);
 assert.match(answer('乙跑3公里18分钟，甲跑3公里18分钟。谁快？'),/相同|并列/);
});
test('pace display rounds total seconds before decomposing minutes and retains original ordering',()=>{
 const s=answer('甲跑5公里用时24.99分钟，乙跑5公里用时25分钟。谁更快？');
 assert.doesNotMatch(s,/4:60/);assert.match(s,/甲平均配速5:00.*乙平均配速5:00/);assert.match(s,/原始.*略快|显示相同/);
 assert.match(answer('甲跑5000米用时25分钟，乙跑5公里用时24分钟。比较配速。'),/甲平均配速5:00.*乙平均配速4:48/);
});
test('corrections apply all preceding user events in sequence, without reading a future event',()=>{
 const p=['我完成4组，每组200米，成绩是30、31、32、33秒。','我刚才记错，第2组实际是29秒，其他不变。'];
 const s=answer('第4组实际是28秒，其他不变，请更新。',p);
 assert.match(s,/旧总时间124秒.*新总时间119秒/);
 assert.match(answer('第1组实际是27秒，其他不变，请更新。',[...p,'第4组实际是28秒，其他不变，请更新。']),/旧总时间119秒.*新总时间116秒/);
 assert.match(answer('第4组实际是28秒，其他不变，请更新。',p.slice(0,1)),/新总时间121秒/);
});
test('explicit completion without a timing preserves distance and marks only total time unknown',()=>{
 const s=answer('我做了4×300米，前3组是58秒、60秒、61秒，第4组已完成但没记录时间。');
 assert.match(s,/完成1200米.*179秒.*总.*未知/);assert.doesNotMatch(s,/完成900米|完成状态未知/);
 assert.match(answer('我做了5×250米，前4组是40秒、41秒、42秒、43秒，第5组完成但未计时。'),/完成1250米.*166秒.*总.*未知/);
});
test('equivalent natural-language correction and missing timing forms preserve the same state',()=>{
 assert.match(answer('第4组改28秒，其他不变，请更新。',['成绩是30、31、32、33秒。','第2组改29秒，其他不变。']),/旧总时间124秒.*新总时间119秒/);
 assert.match(answer('4×300米，前三组58/60/61秒，第四组完成但未计时，汇总。'),/完成1200米.*179秒.*总.*未知/);
});
test('explicit recorded-distance lists sum stated units without assuming complete annual coverage',()=>{
 assert.match(answer('2024年已记录8km和2km，全年记录完整吗？'),/合计10公里.*完整性.*未知|合计10公里.*不能证明/);
});
