/** R4 is reference material. This adapter has no plan, approval, storage or network port. */
import {z} from 'zod'
import rawCards from '../../../../knowledge/professional-r4-20261024/knowledge/retrieval-cards.json' with {type:'json'}
import sourceData from '../../../../knowledge/professional-r4-20261024/knowledge/sources.json' with {type:'json'}
import ranges from '../../../../knowledge/professional-r4-20261024/knowledge/reference-ranges.json' with {type:'json'}
import {retrieve,scaleRange,nutritionTotal} from '../../../../knowledge/professional-r4-20261024/runtime/kb.mjs'

export const R4_VERSION='R4-20261024' as const
export const R4_TASKS=['capability','baseline','fatigue','load','running','strength','warmup','planning','nutrition','communication','memory','data'] as const
export type R4Task=typeof R4_TASKS[number]
const text=z.string().trim().min(1).max(2000),number=z.number().finite().nonnegative()
const fieldsSchema=z.object({
 event:text.optional(),recentResults:z.array(z.unknown()).min(1).optional(),experience:text.optional(),trainingHistory:z.array(z.unknown()).min(1).optional(),
 metric:text.optional(),device:text.optional(),measurementProtocol:text.optional(),symptoms:z.array(z.unknown()).optional(),recentTraining:z.array(z.unknown()).min(1).optional(),
 baselineVersion:text.optional(),outcomeHistory:z.array(z.unknown()).min(1).optional(),loadMethod:text.optional(),dailyObservations:z.array(z.unknown()).length(28).optional(),
 start:text.optional(),timing:text.optional(),surface:text.optional(),restSeconds:number.optional(),purpose:text.optional(),approvedSession:text.optional(),trainingPhase:text.optional(),
 goal:text.optional(),equipment:z.array(text).optional(),completedSets:z.array(z.unknown()).min(1).optional(),technique:text.optional(),effort:text.optional(),priority:text.optional(),
 weeklySchedule:z.array(z.unknown()).optional(),targetPattern:text.optional(),restrictions:z.array(z.unknown()).optional(),sport:text.optional(),mainSession:text.optional(),availableMinutes:number.optional(),
 missedSessions:z.array(z.unknown()).optional(),raceDate:text.optional(),foodEntries:z.array(z.unknown()).min(1).optional(),weightHistory:z.array(z.unknown()).min(1).optional(),trainingSchedule:z.array(z.unknown()).optional(),
 trainingDuration:number.optional(),trainingIntensity:text.optional(),weightKg:number.positive().optional(),trainingContext:text.optional(),duration:number.optional(),environment:text.optional(),fluidHistory:z.array(z.unknown()).min(1).optional(),
 verifiedFacts:z.array(z.unknown()).min(1).optional(),athleteId:text.optional(),recordRevision:z.number().int().nonnegative().optional(),dependencies:z.array(z.unknown()).optional(),source:text.optional(),date:text.optional(),unit:text.optional(),
}).strict()
const requestSchema=z.object({question:text,tasks:z.array(z.enum(R4_TASKS)).min(1).max(12),population:z.enum(['healthy_adult','unknown','special']),fields:fieldsSchema.default({}),limit:z.number().int().min(1).max(28).default(4)}).strict()
export type R4Selection=ReturnType<typeof retrieveR4>
export function retrieveR4(input:unknown){
 const request=requestSchema.parse(input),all=rawCards
 // Each task is explicit; one match means required fields are present, never that
 // protocol, population approval or professional applicability has been established.
 const selected=new Map<string,typeof all[number]>(),needsInput:{id:string;missing:string[]}[]=[],excluded:{id:string;reason:string}[]=[]
 for(const task of new Set(request.tasks)){
  const r=retrieve(all,{...request.fields,question:request.question,task,population:request.population})
  for(const c of r.matched)selected.set(c.id,c)
  needsInput.push(...r.needsInput);excluded.push(...r.excluded)
 }
 const chosen=[...selected.values()].slice(0,request.limit)
 const ids=new Set(chosen.flatMap(c=>c.sourceIds))
 return {version:R4_VERSION,question:request.question,tasks:[...new Set(request.tasks)],population:request.population,
  cards:chosen.map(c=>({...structuredClone(c),version:R4_VERSION,applicability:'NOT_ESTABLISHED' as const})),
  sources:sourceData.sources.filter(s=>ids.has(s.id)).map(s=>structuredClone(s)),needsInput,excluded,
  omittedCardIds:[...selected.keys()].slice(request.limit),status:'REFERENCE_SELECTION_ONLY' as const,autoExecute:false as const,prescriptionApproved:false as const}
}
export function scaleR4Reference(input:unknown){
 const r=z.object({referenceId:text,contextIndex:z.number().int().nonnegative(),weightKg:number.positive(),population:z.literal('healthy_adult')}).strict().parse(input)
 const ref=ranges.references.find(x=>x.id===r.referenceId)
 if(!ref||!('unit' in ref)||ref.unit!=='g/kg/day'||!('contexts' in ref)||!ref.contexts)throw Error('UNSUPPORTED_R4_REFERENCE')
 const context=ref.contexts[r.contextIndex]
 if(!context||!('range' in context)||!Array.isArray(context.range))throw Error('UNKNOWN_R4_CONTEXT')
 const source=sourceData.sources.find(s=>s.id===ref.sourceId)
 if(!source)throw Error('R4_SOURCE_MISSING')
 return {...scaleRange({unit:ref.unit,range:context.range},r.weightKg),version:R4_VERSION,referenceId:ref.id,context:structuredClone(context),source:structuredClone(source),constraints:'constraints' in ref?ref.constraints:[],autoExecute:false as const}
}
const nutrientKeys=['kcal','protein','carb','fat','fiber'] as const
const nutritionSchema=z.array(z.object({kcal:number.nullable().optional(),protein:number.nullable().optional(),carb:number.nullable().optional(),fat:number.nullable().optional(),fiber:number.nullable().optional()}).strict()).max(20000)
export function summarizeR4Nutrition(input:unknown){
 const rows=nutritionSchema.parse(input)
 const totals={} as Record<typeof nutrientKeys[number],{knownSum:number|null;missing:number;status:'UNKNOWN'|'PARTIAL'|'COMPLETE'}>
 for(const key of nutrientKeys)totals[key]=rows.length?nutritionTotal(rows.map(r=>Object.fromEntries(nutrientKeys.map(k=>[k,r[k]??null]))),key):{knownSum:null,missing:0,status:'UNKNOWN'}
 return {...totals,coverage:'UNKNOWN' as const,energyDeficit:null,autoExecute:false as const}
}

/** Resolve existing knowledge evidence; callers must still establish applicability. */
export function readR4Sources(ids: readonly string[]) {
 return sourceData.sources.filter(s=>ids.includes(s.id)).map(s=>structuredClone(s))
}
