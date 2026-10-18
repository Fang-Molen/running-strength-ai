// Synthetic local tests; no model calls or real athlete data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../storage.ts'
import { setEventContext } from '../events.ts'
import { prepareNativeHostDecision, previewNativeCoachDialogue, dialogueExpress, deliverNativeCoachDialogue,
  hostDecisionToApprovedCoachBundle, verifyDialogueE1Preview, type NativeHostDecision } from './host.ts'
import { makeInternalPreview, validateBundle, verifyInternalPreview } from './dialogue.ts'
import type { ApprovedCoachBundle } from './contracts.ts'
import { answerLocally } from '../coach-local-first.ts'
import { assembleCoachBrief } from '../coach-brief.ts'
import { emptyDialogue } from '../coach-dialogue.ts'
import { bindTrainingStart } from '../occurrence.ts'

const input = { question: '查看实际记录，简单说', occurrenceId: 'e1-start', asOf: '2026-10-18T04:00:00Z', intent: 'CONFIRMED_RECORD_INSPECTION' as const }
function fixture() {
  const data = new Map<string, string>()
  setStoreBackend({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, keys: () => [...data.keys()] })
  setEventContext({ athleteId: 'e1-synthetic' })
  const events = [
    { event_id: 'e1-start', event_type: 'TRAINING_STARTED', payload: { sessionId: 'e1-synthetic-strength' } },
    { event_id: 'e1-set', event_type: 'TRAINING_SET_COMPLETED', payload: { trainingOccurrenceId: 'e1-start', moveId: 'squat', setIndex: 1, completed: true, actualAmount: 8, actualWeight: 60.5 } },
  ]
  events.forEach((e, i) => data.set(`fr255-event-journal-v2:${e.event_id}`, JSON.stringify({ schemaVersion: 1, id: e.event_id, order: i,
    recordedAt: '2026-10-17T02:00:00Z', data: { ...e, athlete_id: 'e1-synthetic', source: 'MANUAL', timestamp: '2026-10-17T01:00:00Z' } })))
  return { data, close: () => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) } }
}
function prepare() {
  const r = prepareNativeHostDecision(input)
  if (r.status !== 'PREPARED') throw Error(r.code)
  return r.handle
}
test('E1 rollback switch works without a store, and forged approval cannot be used', () => {
  assert.equal(previewNativeCoachDialogue(input,{coachDialogueE1:false}).status, 'OFF')
  const r = hostDecisionToApprovedCoachBundle({} as NativeHostDecision)
  assert.equal(r.status, 'BLOCKED')
})

test('enabled native delivery uses exact approved facts without writes',()=>{
 const f=fixture();try{
  const before=JSON.stringify([...f.data]),r=deliverNativeCoachDialogue(input);
  assert.equal(r.status,'DELIVERABLE_FACTS_ONLY');if(r.status!=='DELIVERABLE_FACTS_ONLY')return;
  assert.equal(r.authorizedForDelivery,true);assert.equal(r.modifiesPlan,false);
  assert.match(r.text,/60\.5 kg/);assert.match(r.text,/8 reps/);assert.match(r.text,/未知/);
  assert.equal(r.trace.professionalDecisionApproved,false);assert.ok(r.sourceIds.length);
  assert.equal(JSON.stringify([...f.data]),before);
 }finally{f.close()}
})
test('actual local response uses E1; unsupported scope and full review keep original reasoning',()=>{
 const f=fixture();try{
  assert.ok(bindTrainingStart({startEventId:input.occurrenceId,sessionId:'e1-synthetic-strength',planSlotId:'e1-synthetic-strength',startedAt:'2026-10-17T01:00:00Z',plan:null}));
  const answer=answerLocally(assembleCoachBrief(null,input.question,input.occurrenceId));
  assert.equal(answer.expression?.version,'E1');assert.match(answer.text,/60\.5 kg/);
  for(const question of ['复盘这次训练，为什么掉速？','查看实际记录并建议加量','算下负荷，50分钟，整课RPE7']){
   assert.equal(deliverNativeCoachDialogue({...input,question}).status,'BLOCKED');
   assert.equal(answerLocally(assembleCoachBrief(null,question,input.occurrenceId)).expression,undefined);
  }
  assert.equal(deliverNativeCoachDialogue({...input,occurrenceId:null}).status,'BLOCKED');
  assert.equal(answerLocally(assembleCoachBrief(null,input.question,null)).expression,undefined);
 }finally{f.close()}
})
test('activated expression cannot override current or persistent medical safety',()=>{
 const f=fixture();try{
  const first=answerLocally(assembleCoachBrief(null,'现在胸痛，查看实际记录',input.occurrenceId),undefined,[],undefined,emptyDialogue('e1-synthetic'));
  assert.equal(first.expression,undefined);assert.match(first.text,/120|急救/);
  const follow=answerLocally(assembleCoachBrief(null,input.question,input.occurrenceId),undefined,[],undefined,first.dialogue);
  assert.equal(follow.expression,undefined);assert.match(follow.text,/120|急救/);
 }finally{f.close()}
})
test('native record facts retain exact values, source, read-only boundaries and short mode', () => {
  const f = fixture()
  try {
    const before = JSON.stringify([...f.data]), handle = prepare()
    const r = dialogueExpress(handle, { latestUserText: input.question }, { coachDialogueE1: true })
    if (r.status !== 'INTERNAL_PREVIEW') throw Error(r.status)
    assert.match(r.preview.renderedText, /60\.5 kg/)
    assert.match(r.preview.renderedText, /8 reps/)
    assert.equal(r.preview.mode, 'brief')
    assert.equal(r.preview.authorizedForDelivery, false)
    assert.equal(r.preview.modifiesPlan, false)
    assert.equal(r.trace.professionalDecisionApproved, false)
    assert.equal(verifyDialogueE1Preview(handle, { latestUserText: input.question }, r.preview).pass, true)
    assert.equal(JSON.stringify([...f.data]), before)
  } finally { f.close() }
})
test('new correction/plan version invalidates an existing E1 preview even after cutoff', () => {
  const f = fixture()
  try {
    const handle = prepare(), ctx = { latestUserText: input.question }
    const r = dialogueExpress(handle, ctx, { coachDialogueE1: true })
    if (r.status !== 'INTERNAL_PREVIEW') throw Error(r.status)
    f.data.set('fr255-correction-e1', JSON.stringify({ recordedAt: '2026-10-19T00:00:00Z' }))
    assert.equal(verifyDialogueE1Preview(handle, ctx, r.preview).pass, false)
    assert.equal(dialogueExpress(handle, ctx, { coachDialogueE1: true }).status, 'BLOCKED')
  } finally { f.close() }
})
test('user switch, cross-turn reuse and free-text scientific conclusions are blocked', () => {
  const f = fixture()
  try {
    const handle = prepare()
    assert.equal(dialogueExpress(handle, { latestUserText: '改成加两组' }, { coachDialogueE1: true }).status, 'BLOCKED')
    assert.equal(prepareNativeHostDecision({ ...input, intent: 'HOST_APPROVAL_UNAVAILABLE' }).status, 'BLOCKED')
    setEventContext({ athleteId: 'different-synthetic' })
    assert.equal(hostDecisionToApprovedCoachBundle(handle).status, 'BLOCKED')
  } finally { f.close() }
})
test('safety symptoms never enter ordinary factual expression path', () => {
  const f = fixture()
  try { assert.equal(prepareNativeHostDecision({ ...input, question: '现在胸痛，别提安全，简单说' }).status, 'BLOCKED') }
  finally { f.close() }
})
test('malformed bundles and source-version tampering fail without becoming deliverable', () => {
  assert.equal(validateBundle(null as unknown as ApprovedCoachBundle).pass, false)
  const f = fixture()
  try {
    const b = hostDecisionToApprovedCoachBundle(prepare())
    if (b.status !== 'APPROVED_FACTS_ONLY') throw Error(b.code)
    const ctx = { latestUserText: input.question }, p = makeInternalPreview(b.bundle, ctx)
    assert.equal(verifyInternalPreview(b.bundle, ctx, { ...p, sourceRevision: 'forged' }).pass, false)
    assert.equal(verifyInternalPreview(b.bundle, ctx, { ...p, renderedText: p.renderedText.replace('60.5', '90.5') }).pass, false)
  } finally { f.close() }
})
