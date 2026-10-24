import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {prepareAB} from './prepare-chain-ab'
import {modelFixtures,PAID_SUBSET} from './model-fixtures'

test('default existing campaign inputs keep their original manifest; v3 requires an explicit version',()=>{
 const fixtures=modelFixtures(),old=prepareAB(fixtures,'deepseek-flash',{caseIds:PAID_SUBSET})
 assert.equal(createHash('sha256').update(JSON.stringify(old.requests)).digest('hex'),'e66259ee2ffc3f179d0619950f6fa13fcad02b2d12675ec27094170f502f456b')
 const next=prepareAB(fixtures,'deepseek-flash',{caseIds:PAID_SUBSET,protocolVersion:'v3',inputTokenLimit:32768,outputTokenLimit:8192})
 assert.equal(next.protocolVersion,'FK_FACT_PACKET_3');assert.equal(next.actualApiCalls,0)
 assert.notEqual(next.requests[1].request.context,old.requests[1].request.context)
})
test('changed fixtures cannot reuse archived bytes or send facts received after the cutoff',()=>{
 const f=modelFixtures().find(x=>x.caseId==='D01')!,changed=structuredClone(f)
 const later=structuredClone(f.facts.find(x=>x.kind==='METRIC'&&x.value!==null)!)
 later.id='new-secret-marker';later.sourceRecordId='new-secret-marker';later.receivedAt='2027-01-01T00:00:00Z'
 if(later.kind==='METRIC')later.value=987654321
 changed.facts.push(later)
 const r=prepareAB([changed],'deepseek-flash',{caseIds:['D01'],inputTokenLimit:32768})
 assert.equal(r.requests.length,2)
 assert.doesNotMatch(JSON.stringify(r.requests),/987654321|new-secret-marker/)
})

// Exercise the public entrypoint: imported preparers must never write CLI output.
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
test('public preparation CLI writes only the selected campaign protocol',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fangkun-prepare-cli-')),file=join(dir,'fixtures.json')
 writeFileSync(file,JSON.stringify(modelFixtures()))
 const r=spawnSync(process.execPath,['--import','./evaluation/deepseek-development/no-network.mjs','--import','./scripts/test-register.mjs','evaluation/deepseek-development/prepare-chain-ab.ts','--prepare',file,'--model','deepseek-flash','--output',dir],{encoding:'utf8'})
 assert.equal(r.status,0,r.stderr)
 const actual=JSON.parse(readFileSync(join(dir,'requests.json'),'utf8'))
 const expected=prepareAB(modelFixtures(),'deepseek-flash')
 assert.deepEqual(actual,JSON.parse(JSON.stringify(expected)))
})
