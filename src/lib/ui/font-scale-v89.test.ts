import test from 'node:test';import assert from 'node:assert/strict';
import {FONT_SCALE_KEY,normalizeFontScale,readFontScale,writeFontScale} from './font-scale-v89.ts';
test('invalid preference defaults to standard',()=>assert.equal(normalizeFontScale('giant'),'standard'));
test('read handles storage unavailable',()=>assert.equal(readFontScale({getItem(){throw Error('unavailable')}}),'standard'));
test('persist and reload only typography',()=>{const m=new Map<string,string>();const s={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}};assert.equal(writeFontScale(s,'extra'),true);assert.equal(readFontScale(s),'extra');assert.deepEqual([...m.keys()],[FONT_SCALE_KEY])});
test('silent storage failure does not claim a persisted preference',()=>assert.equal(writeFontScale({getItem:()=>null,setItem:()=>{}},'extra'),false));
