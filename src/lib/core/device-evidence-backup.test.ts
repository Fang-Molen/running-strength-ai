import test from 'node:test'
import assert from 'node:assert/strict'
import {validateEvidenceBackup,importDeviceEvidenceBackup} from './device-evidence-backup.ts'
const base={format:'fr255-device-evidence-backup',version:1,exportedAt:'2026-10-11T00:00:00Z',entries:[]}
test('empty backup accepted',()=>assert.doesNotThrow(()=>validateEvidenceBackup(base)))
test('reject unknown schema',()=>assert.throws(()=>validateEvidenceBackup({...base,version:2})))
test('reject malformed record',()=>assert.throws(()=>validateEvidenceBackup({...base,entries:[{record:{id:'x'},imageBase64:null,imageType:null}]})))
test('restore requires confirmation',async()=>await assert.rejects(importDeviceEvidenceBackup(base,false),/确认/))
test('reject excessive entries',()=>assert.throws(()=>validateEvidenceBackup({...base,entries:Array(2001).fill(null)})))
