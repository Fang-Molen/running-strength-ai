import test from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {CoachAnswerValidation} from './coach-answer-validation';
test('partial and clarification never present as completed; professional status stays separate',()=>{
 const html=renderToStaticMarkup(createElement(CoachAnswerValidation,{decision:'PARTIAL',professionalReview:'PENDING',sources:['已记录5公里','已记录5公里']}));
 assert.match(html,/部分完成/);assert.match(html,/专业适用性待复核/);assert.equal((html.match(/<li /g)??[]).length,1);assert.doesNotMatch(html,/<details open/);
 const ask=renderToStaticMarkup(createElement(CoachAnswerValidation,{decision:'NEEDS_CLARIFICATION'}));assert.match(ask,/尚未形成完整方案/);
});
