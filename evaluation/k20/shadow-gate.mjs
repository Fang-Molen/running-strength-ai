import {readFileSync} from 'node:fs'
import {snapshotKnownEvents,buildKnownAtModelContext} from '../../src/lib/core/asof-event-ledger.ts'
const fixture=JSON.parse(readFileSync(new URL('./shadow-fixtures.json',import.meta.url),'utf8'))
let checks=0
for(const s of fixture.scenarios){
 for(const c of s.checkpoints){
  const r=snapshotKnownEvents(s.events,c.asOf)
  const model=buildKnownAtModelContext(s.events,c.asOf)
  if(c.expectedValue!==undefined&&r.facts[0]?.value!==c.expectedValue)throw Error(s.id+' value mismatch')
  if(c.expectedCount!==undefined&&r.facts.length!==c.expectedCount)throw Error(s.id+' count mismatch')
  for(const id of c.mustNotKnow??[])if(model.includes(id))throw Error(s.id+' leaked event '+id)
  for(const flag of c.mustFlag??[])if(!r.issues.includes(flag)&&!model.includes(flag))throw Error(s.id+' missing flag '+flag)
  if(r.trainingDecisionAuthorized!==false||r.clinicalClearance!=='UNKNOWN')throw Error(s.id+' unsafe decision state')
  checks++
 }
}
console.log(JSON.stringify({status:'PASS',scenarios:fixture.scenarios.length,checkpoints:checks,modelCalls:0,notes:'Synthetic as-of ledger checks only; not real coach inference'}))
