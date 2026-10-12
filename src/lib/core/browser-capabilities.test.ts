import test from 'node:test';import assert from 'node:assert/strict';import {browserCapabilities,imageEntryMode} from './browser-capabilities.ts'
test('no browser safely falls back to text',()=>assert.equal(imageEntryMode(browserCapabilities({window:{},navigator:{},global:{}})),'TEXT_ONLY'))
test('image input without native OCR falls back to review',()=>{const c=browserCapabilities({window:{File:class{},document:{createElement(){}}},navigator:{},global:{}});assert.equal(imageEntryMode(c),'MANUAL_IMAGE')})
test('native detector is capability-gated',()=>{const c=browserCapabilities({window:{File:class{},document:{createElement(){ }},TextDetector:class{}},navigator:{},global:{createImageBitmap(){}}});assert.equal(imageEntryMode(c),'LOCAL_OCR')})
test('storage is checked separately',()=>{const c=browserCapabilities({window:{indexedDB:{}},navigator:{},global:{}});assert.equal(c.indexedDb,true);assert.equal(c.nativeTextDetector,false)})
