import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {PetCaptureHost} from './pet-capture'
test('capture menu has four equivalent actions and closes as an accessible sheet',()=>{const html=renderToStaticMarkup(createElement(PetCaptureHost,{onCoach:()=>{},initialAction:'menu'}));for(const label of ['记饮食','补训练反馈','记身体状态','问方坤'])assert.match(html,new RegExp(label));assert.match(html,/aria-modal="true"/);assert.match(html,/aria-label="关闭"/)})
