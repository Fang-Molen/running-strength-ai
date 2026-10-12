import test from 'node:test'
import assert from 'node:assert/strict'
import { assessEvidenceReadiness } from './athlete-evidence-readiness.ts'
import type { AthleteEvidence } from './athlete-evidence-audit.ts'
const r=(id:string,kind:AthleteEvidence['kind'],date:string,value:number):AthleteEvidence=>({id,kind,date,value,source:'SELF_REPORT'})
test('stale recovery does not become current recovery',()=>{const out=assessEvidenceReadiness([r('a','SESSION','2026-10-10',140),r('b','RECOVERY','2026-09-01',7)],'2026-10-10');assert.ok(out.missing.includes('STALE_RECOVERY_EVIDENCE'));assert.equal(out.decisionAuthorization,false)})
test('future evidence cannot silently justify today',()=>{const out=assessEvidenceReadiness([r('a','SESSION','2026-10-12',140)],'2026-10-10');assert.ok(out.missing.includes('FUTURE_SESSION_EVIDENCE'))})
test('conflicting evidence remains unresolved',()=>{const out=assessEvidenceReadiness([r('a','SESSION','2026-10-10',140),r('a','SESSION','2026-10-10',130)],'2026-10-10');assert.ok(out.missing.includes('UNRESOLVED_EVIDENCE_CONFLICT'))})
test('invalid reference day rejected',()=>{assert.equal(assessEvidenceReadiness([],'2026-02-30').status,'INVALID_REFERENCE_DATE')})
