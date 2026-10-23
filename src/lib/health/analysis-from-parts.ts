import type { TrainingPart } from './muscle-recovery-u11'
import type { TrainingFact } from './analysis-contract'
import { projectAnalysisEvidence } from './analysis-evidence'
/** Adapter only: all actuals come from existing occurrence/import projections. */
export function analysisFromParts(athleteId:string,asOf:string,parts:TrainingPart[]){
 const facts:TrainingFact[]=parts.map(p=>({id:`${p.sourceId}:${p.componentId??p.modality}`,revision:p.revision??0,athleteId:p.athleteId,provider:p.provenance?.provider??'APP',accountRef:p.provenance?.accountRef??null,deviceId:p.deviceId??null,protocolKey:p.protocolKey??null,sourceRecordId:p.provenance?.recordId??p.sourceId,occurredAt:p.occurredAt,knownAt:p.knownAt,receivedAt:p.provenance?.receivedAt??p.knownAt,sourceTimeZone:null,status:p.actual,quality:'PARTIAL',ownershipReceiptId:null,kind:'TRAINING',canonicalActivityId:p.occurrenceId??p.eventId,occurrenceId:p.occurrenceId??p.eventId,componentId:p.componentId??p.modality,modality:p.modality,startedAt:p.occurredAt,endedAt:p.endedAt??null,plannedPurpose:p.plannedPurpose??null,observedType:p.runType??null,observedTypeBasis:p.runType&&p.runType!=='UNKNOWN'?[{id:p.eventId,revision:p.revision??0}]:[],sessionRpe:p.sessionRpe??null,sessionRpeScale:p.sessionRpeScale??null,actualDurationSeconds:p.actualDurationSeconds??null,runSegments:p.runSegments??[],strengthSets:p.strengthSets??[],jumpContacts:null,
  // Retain Component→Block→Step and separately labelled planned/actual rests.
  runningStructure:p.runningStructure??null} as TrainingFact))
 return projectAnalysisEvidence({context:{athleteId,asOf,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,planVersion:null,consentVersion:'LOCAL_ONLY',analysisVersion:'LOGIC_LOAD_1'},facts})
}
