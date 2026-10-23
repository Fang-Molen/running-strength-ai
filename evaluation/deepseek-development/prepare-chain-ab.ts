/** Offline request preparation only. No API client, credentials, network or model calls. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {buildCoachAnalysisPacket,analysisModelView} from '../../src/lib/health/analysis-packet'
import {projectAnalysisEvidence} from '../../src/lib/health/analysis-evidence'
import {buildMuscleExposure} from '../../src/lib/health/muscle-exposure'
import {evaluateRecoveryEvidence} from '../../src/lib/health/recovery-assessment'
import type {AnalysisFact,Context} from '../../src/lib/health/analysis-contract'
export type ABFixture={caseId:string;context:Context;facts:AnalysisFact[];provenance:'PUBLIC_SYNTHETIC';frozenVersion:string}
export function prepareAB(fixtures:ABFixture[],model:string){
 if(!model||!Array.isArray(fixtures)||new Set(fixtures.map(f=>f.caseId)).size!==fixtures.length)throw Error('INVALID_AB_INPUT')
 const catalog=JSON.parse(readFileSync(new URL('./cases-60.json',import.meta.url),'utf8'))
 const requests:any[]=[],blocked:{caseId:string;reason:string}[]=[]
 for(const c of catalog.cases){
  const f=fixtures.find(f=>f.caseId===c.id)
  if(!f||f.provenance!=='PUBLIC_SYNTHETIC'||!f.frozenVersion||!f.facts.length){blocked.push({caseId:c.id,reason:'NO_FROZEN_SYNTHETIC_FACT_BINDING'});continue}
  const s=projectAnalysisEvidence({context:f.context,facts:f.facts}),a=evaluateRecoveryEvidence(s),e=buildMuscleExposure(s),packet=buildCoachAnalysisPacket(s,a,e),view=analysisModelView(packet).view
  // Both arms receive identical factual information and the same question/model.
  // A lacks B's structured competing explanations, counterevidence and candidate preparation.
  const common={model,maxOutputTokens:900,toolRounds:0,retries:0,caseId:c.id,fixtureVersion:f.frozenVersion,snapshotId:s.snapshotId,status:'PREPARED_NOT_EXECUTED',requiresCostApproval:true}
  for(const arm of ['A','B']){const content=arm==='A'?view.observations.map((o:any)=>o.text).join('\n'):JSON.stringify(view)
   requests.push({...common,arm,request:{question:c.prompt,context:content},inputUtf8Bytes:new TextEncoder().encode(content).length,inputTokens:null,outputTokens:null,latencyMs:null,actualCost:null})}
 }
 return {schemaVersion:1,status:'NOT_RUN',actualApiCalls:0,actualProviderTokens:0,model,requests,blocked,plannedCalls:requests.length,maximumCatalogCalls:120,comparability:'Same model and frozen facts; synthetic development cases, not blind scientific validation.'}
}
// No automatic paid execution entry point is included. Existing trusted server is the only transport.
if(process.argv.includes('--prepare')){
 const path=process.argv[process.argv.indexOf('--prepare')+1],out=process.argv[process.argv.indexOf('--output')+1],model=process.argv[process.argv.indexOf('--model')+1]
 if(!path||!out||!model)throw Error('Usage: --prepare fixtures.json --model approved-model --output output-directory')
 const result=prepareAB(JSON.parse(readFileSync(path,'utf8')),model);mkdirSync(out,{recursive:true});writeFileSync(out+'/requests.json',JSON.stringify(result,null,2))
 writeFileSync(out+'/scoring-contract.json',JSON.stringify({automatic:['fact_reference_validity','number_unit_accuracy','missing_not_zero','no_plan_write','source_time_isolation'],expert:['competing_explanations','counterevidence','actionability','safety','individualization'],measurement:['provider_returned_model','input_tokens','output_tokens','cache_tokens','latency_ms','actual_invoice_cost'],rules:['Expected answers and evaluator metadata must not enter either request','Never treat a local pass as a coach ability score','Use identical model/version/settings in both arms','Collect token/cost/latency from actual receipts; unknown remains null','No API calls without explicit cost approval']},null,2))
}
