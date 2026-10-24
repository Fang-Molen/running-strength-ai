/** Reviewer receives original neutral facts and raw answers, never arms or prompts. */
import {randomUUID,randomInt} from 'node:crypto'
export function blindExport(receipts:any[],samples:any[],rubric:any){
 const mapping:any[]=[],sheets:any[]=[]
 for(const r of receipts){const s=samples.find(s=>s.sampleId===r.sampleId);if(!s)throw Error('UNKNOWN_RECEIPT');const blindId=randomUUID();mapping.push({blindId,sampleId:s.sampleId,caseId:s.caseId,arm:s.arm});sheets.push({blindId,question:s.request.request.question,neutralFacts:s.request.sourceText,rawAnswer:r.rawAnswer??null,transportValid:r.state==='SETTLED'&&r.transportErrors.length===0,rubric:rubric.cases.find((c:any)=>c.caseId===s.caseId),numericTolerance:rubric.numericTolerance,safetyVeto:rubric.safetyVeto,dimensions:rubric.dimensions,scores:null,scientificExpertScore:null,reviewer:null})}
 for(let i=sheets.length-1;i>0;i--){const j=randomInt(i+1);[sheets[i],sheets[j]]=[sheets[j],sheets[i]]}
 return {reviewerSheets:sheets,privateMapping:mapping,disclosure:'Answers can reveal processing style; allocation labels and all B prompts are withheld. Independent expert review is not automatic.'}
}
