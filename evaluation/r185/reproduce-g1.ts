import assert from 'node:assert/strict'
import test from 'node:test'
import {parseChatTraining,saveChatTraining,chatEvolution} from '../../src/lib/core/coach-chat-evidence.ts'
import {firstWeekMemory} from '../../src/lib/core/coach-first-week.fixtures.ts'
import {setStoreBackend} from '../../src/lib/core/storage.ts'
import {importedFormalRows} from '../../src/lib/core/coach-import-evidence.ts'
import {normalizeTrainingImportCandidate} from '../../src/lib/core/training-import.ts'
test('G1 duration without confirmed sport must not become strength',()=>{setStoreBackend(firstWeekMemory());try{assert.equal(saveChatTraining(parseChatTraining('今天练了50分钟，整课RPE7'),'2026-10-10T08:00:00Z',true).ok,false)}finally{setStoreBackend(null)}})
test('G1 round-only rest does not become repetition rest',()=>{const c=parseChatTraining('今天200米×2×2，38/39/40/41秒，轮间休息8分钟');assert.equal(c.restSeconds,null);assert.equal(c.roundRestSeconds,480)})
test('G1 two-level rest persists and reaches formal evidence',()=>{setStoreBackend(firstWeekMemory());try{const c=parseChatTraining('今天200米×4×2，39/38/没记/36/40/41/42/43秒，组间2分钟，轮间8分钟');const saved=saveChatTraining(c,'2026-10-10T08:00:00Z',true);assert.ok(saved.ok);const rows=importedFormalRows([saved.record],saved.record.athleteId??'local',new Date().toISOString());assert.equal(rows.filter(r=>r.metric==='REST_SECONDS'&&r.value===480&&r.protocol.includes('AFTER_ROUND')).length,1);assert.equal(rows.filter(r=>r.metric==='REST_SECONDS'&&r.value===120).length,6);assert.equal(saved.record.runningSegments[7].recoverySeconds.value,null)}finally{setStoreBackend(null)}})
test('G1 actual zero RPE is retained instead of treated as absent',()=>assert.equal(normalizeTrainingImportCandidate({sessionRpe:{value:0,status:'RECORDED',sourceIds:['synthetic']}}).sessionRpe.value,0))
