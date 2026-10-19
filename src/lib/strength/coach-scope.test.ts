import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { freshMemory, loadCoach, saveCoach, coachStorageKey } from './coach.ts'
import { setEventContext } from '../core/events.ts'
import { emptyDialogue } from '../core/coach-dialogue.ts'
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)} })
  setEventContext({ athleteId: 'local' })
})
afterEach(() => {
  setEventContext({ athleteId: 'local' })
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})
test('unscoped legacy history remains local and is never copied to another athlete', () => {
  const old = {...freshMemory(),athleteId:undefined,messages:[{id:'legacy',role:'user',text:'LOCAL_PRIVATE'}]}
  data.set('fr255-coach-v2', JSON.stringify(old)); const original = data.get('fr255-coach-v2')
  assert.equal(loadCoach().messages[0].text, 'LOCAL_PRIVATE'); assert.equal(loadCoach().athleteId, 'local')
  setEventContext({athleteId:'B'}); assert.equal(loadCoach().athleteId,'B'); assert.doesNotMatch(JSON.stringify(loadCoach()),/LOCAL_PRIVATE/)
  assert.equal(data.get('fr255-coach-v2'),original)
})
test('save/reload keeps separate chat, dialogue and reasoning receipt for each athlete', () => {
  for (const id of ['A','B']) {
    setEventContext({athleteId:id})
    assert.equal(saveCoach({...freshMemory(),dialogue:{...emptyDialogue(id),goal:`goal-${id}`},messages:[{id:'message',role:'user',text:`private-${id}`}]}),true)
  }
  setEventContext({athleteId:'A'}); assert.equal(loadCoach().messages[0].text,'private-A');assert.equal(loadCoach().dialogue?.goal,'goal-A')
  assert.equal(data.has(coachStorageKey('A')),true); assert.equal(data.has(coachStorageKey('B')),true)
  setEventContext({athleteId:'local'}); assert.doesNotMatch(JSON.stringify(loadCoach()),/private-A|private-B/)
})
test('stale in-memory chat or foreign dialogue cannot be saved after athlete switches', () => {
  setEventContext({athleteId:'A'});const a=freshMemory()
  setEventContext({athleteId:'B'});assert.equal(saveCoach(a),false)
  assert.equal(saveCoach({...freshMemory(),dialogue:emptyDialogue('A')}),false)
  assert.equal(data.size,0)
})
test('corrupted ownership in an otherwise valid scoped record is rejected read-only', () => {
  setEventContext({athleteId:'A'})
  data.set(coachStorageKey(),JSON.stringify({...freshMemory(),athleteId:'B',messages:[{id:'bad',role:'user',text:'FOREIGN'}]}))
  const before=[...data];assert.doesNotMatch(JSON.stringify(loadCoach()),/FOREIGN/);assert.deepEqual([...data],before)
})
test('old local v1 history remains readable without deleting or rewriting it', () => {
  data.set('fr255-coach-v1',JSON.stringify({...freshMemory(),athleteId:undefined,messages:[{id:'old',role:'user',text:'OLD_HISTORY'}]}))
  const before=[...data];assert.match(JSON.stringify(loadCoach()),/OLD_HISTORY/);assert.deepEqual([...data],before)
})
