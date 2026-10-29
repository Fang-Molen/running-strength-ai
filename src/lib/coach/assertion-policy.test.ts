import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCoachAssertions } from './assertion-policy';
test('educational ranges and unit conversions do not require personal evidence',()=>{
 for(const text of ['RPE 的取值范围为 1 到 10。','5公里等于5000米。','一般情况下，你可以用1到10的RPE量表描述用力程度。'])
  assert.equal(validateCoachAssertions(text,{factQuotes:[],safetyRestricted:false}).ok,true,text);
});
test('educational wording cannot hide unsupported personal measurements or prescriptions',()=>{
 for(const text of ['一般情况下，你昨天跑了5公里。','RPE量表范围1到10，你今天实际RPE为7。','建议你明天跑5公里。','5公里等于500米。'])
  assert.equal(validateCoachAssertions(text,{factQuotes:[],safetyRestricted:false}).ok,false,text);
});
test('overlapping verified source quotes are removed longest first without losing calculation evidence',()=>{
 const calculation='实际完成3组、30次；每只手负重次数积360 kg·次；跳过的组不计入完成（按用户自述计算，未核验、未写入记录，不代表完整覆盖或生理结论。）';
 const options={factQuotes:['实际完成3组',calculation],safetyRestricted:false};
 assert.equal(validateCoachAssertions(calculation,options).ok,true);
 assert.equal(validateCoachAssertions(calculation+' 你还完成了400次。',options).ok,false);
});
test('negated modification of an already saved record is not a new save claim',()=>{
 const options={factQuotes:[],safetyRestricted:false};
 assert.equal(validateCoachAssertions('旧自述保留，未改写已保存记录。',options).ok,true);
 assert.equal(validateCoachAssertions('未改写已保存记录，但已经保存了记录。',options).ok,false);
 assert.equal(validateCoachAssertions('已经替你修改了记录。',options).ok,false);
});
