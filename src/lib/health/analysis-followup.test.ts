import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend,writeEnvelope} from '../core/storage'
import {setEventContext} from '../core/events'
import {createTrainingImportDraft,normalizeConfirmedTrainingImport,CONFIRMED_TRAINING_IMPORTS_KEY} from '../core/training-import'
import {TRAINING_FOLLOWUPS_KEY} from '../core/training-followup'
import {importedResponseFacts} from './analysis-followup'
import {training} from './analysis-fixtures'
test('C35 follow-up needs its confirmed occurrence; naked provider IDs never rebind after VOID',t=>{
 const data=new Map<string,string>();setStoreBackend({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)}});setEventContext({athleteId:'SYN-A'})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
 const recorded=<T>(value:T)=>({value,status:'RECORDED' as const,sourceIds:['text']})
 const occurredAt='2026-10-21T08:00:00Z',confirmedAt='2026-10-21T09:00:00Z',observedAt='2026-10-22T09:00:00Z'
 const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:recorded(occurredAt),title:recorded('synthetic run'),durationSeconds:recorded(1800),totalDistanceMeters:recorded(1000),runningStructure:'CONTINUOUS',runningSegments:[{id:'r1',kind:'CONTINUOUS',distanceMeters:recorded(1000),durationSeconds:recorded(1800),completion:'COMPLETED',sourceIds:['text']}],strengthSets:[]},'TEXT',['text'])
 const record=normalizeConfirmedTrainingImport({...draft,draftId:'source-a',athleteId:'SYN-A',createdAt:confirmedAt,confirmedAt,confirmedImportId:'confirmed:source-a',userConfirmed:true,recordMode:'ACTUAL_ONLY',canonicalOccurrenceId:null,provenance:{provider:'COROS',accountRef:'account-A',recordId:'12345',measuredAt:occurredAt,receivedAt:confirmedAt}})!
 assert.ok(record);writeEnvelope(CONFIRMED_TRAINING_IMPORTS_KEY,[record])
 writeEnvelope(TRAINING_FOLLOWUPS_KEY,[{schemaVersion:1,requestId:'f1',confirmedImportId:record.confirmedImportId,followupId:'followup:f1',savedAt:observedAt,observedAt,recoveryScore:null,sleepHours:null,pain:{state:'PRESENT',location:'腘绳肌',intensity:3},soreness:{state:'UNKNOWN',location:null,intensity:null},elapsedSeconds:(Date.parse(observedAt)-Date.parse(occurredAt))/1000,window:'24H',canonicalOccurrenceId:null}])
 const other=training({id:'source-b:running',athleteId:'SYN-A',occurrenceId:'confirmed:source-b',canonicalActivityId:'confirmed:source-b',provider:'COROS',accountRef:'account-B',deviceId:'watch-B',sourceRecordId:'12345',startedAt:occurredAt,occurredAt,knownAt:confirmedAt,receivedAt:confirmedAt})
 assert.deepEqual(importedResponseFacts('SYN-A','2026-10-22T20:00:00Z',[other]),[])
 const own={...other,id:'source-a:running',occurrenceId:record.confirmedImportId,accountRef:'account-A',deviceId:'watch-A'}
 const actual=importedResponseFacts('SYN-A','2026-10-22T20:00:00Z',[own]);assert.equal(actual.length,1);assert.equal(actual[0].value,3);assert.deepEqual(actual[0].relatedTrainingRefs,[{id:own.id,revision:own.revision}])
 assert.deepEqual(importedResponseFacts('SYN-A','2026-10-22T20:00:00Z',[]),[])
 assert.deepEqual(importedResponseFacts('SYN-A','2026-10-22T08:00:00Z',[own]),[])
})
