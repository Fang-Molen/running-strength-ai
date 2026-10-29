import test from 'node:test';import assert from 'node:assert/strict';
import {parseStrictJson} from './strict-json';
test('duplicate decoded keys at any depth cannot silently choose the last policy',()=>{
 for(const s of ['{"decision":"SAFE_REFUSAL","decision":"VALIDATED"}','{"x":{"id":1,"\\u0069d":2}}'])assert.throws(()=>parseStrictJson(s),/DUPLICATE/);
 assert.deepEqual(parseStrictJson('{"a":[{"x":1},{"x":2}],"b":"a\\\"b"}'),{a:[{x:1},{x:2}],b:'a"b'});
});
test('partial JSON, trailing values and unbounded depth fail closed',()=>{
 for(const s of ['{"text":"unfinished','{"x":1} {}','['.repeat(70)+'0'+']'.repeat(70)])assert.throws(()=>parseStrictJson(s));
});
