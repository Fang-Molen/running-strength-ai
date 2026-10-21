import assert from 'node:assert/strict';
import test from 'node:test';
import { freshMemory, recordedCoachFatigue } from '../strength/coach.ts';

test('reading a knowledge article never turns the default fatigue placeholder into personal evidence',()=>{
  const memory=freshMemory();
  memory.messages.push({id:'reading-user',role:'user',text:'请解释800米训练',purpose:'KNOWLEDGE_READING'});
  memory.messages.push({id:'reading-coach',role:'coach',text:'一般教学讲解',purpose:'KNOWLEDGE_READING'});
  assert.equal(recordedCoachFatigue(memory),null);
});
test('knowledge reading does not erase an existing fatigue record',()=>{
  const memory=freshMemory();memory.fatigue=48;
  memory.messages.push({id:'reading',role:'user',text:'查看来源',purpose:'KNOWLEDGE_READING'});
  assert.equal(recordedCoachFatigue(memory),48);
});
