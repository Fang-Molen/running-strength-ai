import test from 'node:test'
import assert from 'node:assert/strict'
import {ocrAvailability,validateOcrImage,mergeOcrText,ocrConfidenceLabel} from './local-ocr-policy.ts'
test('no detector never implies OCR support',()=>assert.equal(ocrAvailability(undefined),'MANUAL_ONLY'))
test('native detector is available only if supplied',()=>assert.equal(ocrAvailability(class Detector {}),'NATIVE_LOCAL'))
test('reject unsupported or oversized images',()=>{assert.ok(validateOcrImage('image/svg+xml',12));assert.ok(validateOcrImage('image/png',7*1024*1024));assert.equal(validateOcrImage('image/png',100),null)})
test('empty OCR result cannot erase manual text',()=>assert.equal(mergeOcrText('原文',' '),'原文'))
test('confidence is not fabricated',()=>assert.equal(ocrConfidenceLabel(),'UNAVAILABLE'))
