import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSupportingGoals,saveSupportingGoals,loadSupportingGoals} from './goal-portfolio.ts'
test('multiple supporting goals are deduplicated and exclude primary',()=>{
 assert.deepEqual(normalizeSupportingGoals(['muscle','muscle','performance','bad','strength'],'performance'),['muscle','strength'])
})
test('portfolio can be saved and loaded independently',()=>{
 const map=new Map<string,string>();const storage={keys:()=>[...map.keys()], getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)}}
 assert.equal(saveSupportingGoals(storage,['muscle','strength'],'performance'),true)
 assert.deepEqual(loadSupportingGoals(storage,'performance'),['muscle','strength'])
})
