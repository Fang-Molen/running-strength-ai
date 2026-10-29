import test from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CoachAnswerView} from './coach-answer-view';
test('verified complete groups remain visible; a preceding evidence line cannot hide the answer',()=>{
 const text='我没有腿疼\nRPE是主观用力程度量表。\n常用CR10描述主观努力，不能确认恢复或医学安全。';
 const html=renderToStaticMarkup(createElement(CoachAnswerView,{text,verified:true}));assert.doesNotMatch(html,/<details/);assert.match(html,/RPE是主观用力程度量表/);assert.match(html,/不能确认恢复或医学安全/);
});
