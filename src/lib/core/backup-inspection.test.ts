import assert from 'node:assert/strict'
import test from 'node:test'
import { collectLocalBackup, inspectLocalBackup } from './trial.ts'
function store(initial: Record<string,string>) { const data = new Map(Object.entries(initial)); return { keys:()=>[...data.keys()], getItem:(k:string)=>data.get(k)??null, key:(i:number)=>[...data.keys()][i]??null, get length(){return data.size} } }
test('backup preview classifies new, overwritten and unchanged without writing',()=>{
 const backup=collectLocalBackup(store({'fr255-a':'same','fr255-b':'old','fr255-c':'new'}),'2026-10-10T00:00:00Z')
 const existing=store({'fr255-a':'same','fr255-b':'changed'})
 assert.deepEqual(inspectLocalBackup(backup,existing),{ok:true,total:3,added:1,overwritten:1,unchanged:1,exportedAt:'2026-10-10T00:00:00Z'})
 assert.equal(existing.getItem('fr255-b'),'changed')
})
test('backup preview rejects unsupported payloads',()=>{
 assert.equal(inspectLocalBackup('{}',store({})).ok,false)
 assert.equal(inspectLocalBackup(JSON.stringify({kind:'fr255-local-backup',keys:{'invalid':'x'}}),store({})).ok,false)
})
