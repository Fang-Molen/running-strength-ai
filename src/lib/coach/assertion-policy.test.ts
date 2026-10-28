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
