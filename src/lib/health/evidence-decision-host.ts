import { currentAthleteId } from '../core/events'
import { readSavedSessionLoads, readLoadCoverage } from '../core/coach-load-metrics-store'
import { loadHealthSnapshot } from './snapshot'
import { dailyCheckin } from './analysis'
import { readRecoveryProjection, recoveryExplanation } from './recovery-host-u11'
import { loadEntries } from '../nutrition/log'
import { buildEvidenceDecision } from './evidence-decision'
import { localDay } from './observation'
import { readAnalysis, analysisText } from './analysis-host'
/** Shared read-only host, recomputed from current versions after each app event. */
export function readEvidenceDecision(day=localDay(),asOf=new Date().toISOString(),question=''){
 const athleteId=currentAthleteId(),muscle=readRecoveryProjection(day,asOf),foods=loadEntries().filter(f=>f.date===day&&(f.athleteId??'local')===athleteId&&!!f.recordedAt&&Date.parse(f.recordedAt)<=Date.parse(asOf))
 const d=buildEvidenceDecision({athleteId,day,asOf,question,offset:-new Date(asOf).getTimezoneOffset(),snapshot:loadHealthSnapshot(day),checkin:dailyCheckin(day,asOf),sessions:readSavedSessionLoads(athleteId,asOf),coverage:readLoadCoverage(athleteId,asOf),muscle:{text:recoveryExplanation(muscle),revision:muscle.revision,sourceIds:muscle.sources.map(s=>s.id),unreadable:muscle.unreadable,hasPain:muscle.review.regions.some(r=>r.state==='PAIN_REVIEW')},nutrition:{count:foods.length,kcal:foods.reduce((n,f)=>n+(typeof f.kcal==='number'&&Number.isFinite(f.kcal)&&f.kcal>=0?f.kcal:0),0),pending:foods.filter(f=>f.kcal==null||!Number.isFinite(f.kcal)||f.kcal<0).length}})
 const analysis=readAnalysis(day,asOf,question)
 d.evidence.push({id:'compound:'+analysis.revision,text:analysisText(analysis),sourceIds:analysis.snapshot.facts.map(f=>f.id),kind:'DESCRIPTIVE'})
 d.revision+=':'+analysis.revision
 // Require real supporting references instead of forcing two generic explanations.
 d.hypotheses=d.hypotheses.filter(h=>h.support.length>0)
 return {...d,analysis}
}
