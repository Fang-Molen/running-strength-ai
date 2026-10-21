import test from 'node:test';
import assert from 'node:assert/strict';
import { setStoreBackend } from '../core/storage';
import { onlineFeatures, setOnlineFeature, ONLINE_FEATURES_KEY } from './online-features';
import { onlineSetting, setOnline, COACH_ONLINE_KEY } from '../coach/online-coach';
import { COACH_NETWORK_MODE_KEY } from '../core/coach-network-policy';

function useStore(values: Record<string, string>) {
  const data = new Map(Object.entries(values));
  setStoreBackend({getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }});
  return data;
}
const saved = (features: Record<string, unknown>) => JSON.stringify({consentAt:'2026-10-20T00:00:00Z',by:'test',features});
test.afterEach(() => setStoreBackend(null));

test('repairing damaged aggregate settings preserves explicit coach and reference OFF', () => {
  useStore({[ONLINE_FEATURES_KEY]:'{broken', [COACH_ONLINE_KEY]:JSON.stringify({on:false}), [COACH_NETWORK_MODE_KEY]:'local'});
  assert.equal(onlineFeatures().features.coach, false);
  assert.equal(onlineFeatures().features.coachRefs, false);
  setOnlineFeature('foodEstimate', true);
  assert.equal(onlineSetting().on, false);
});
test('damaged coach record does not reset unrelated disabled features', () => {
  useStore({[ONLINE_FEATURES_KEY]:saved({coach:false,coachRefs:false,ocrText:false,foodEstimate:false}), [COACH_ONLINE_KEY]:'{bad'});
  assert.deepEqual(onlineFeatures().features, {coach:false,coachRefs:false,ocrText:false,foodEstimate:false});
  assert.equal(onlineSetting().on, false);
});
test('a legacy reference switch remains authoritative when another setting changes', () => {
  const data = useStore({[ONLINE_FEATURES_KEY]:saved({coachRefs:true}), [COACH_NETWORK_MODE_KEY]:'local'});
  assert.equal(onlineFeatures().features.coachRefs, false);
  setOnlineFeature('ocrText', false);
  assert.equal(data.get(COACH_NETWORK_MODE_KEY),'local');
});
test('turning one feature ON does not turn other disabled features ON', () => {
  useStore({[ONLINE_FEATURES_KEY]:saved({coach:false,coachRefs:false,ocrText:false,foodEstimate:false})});
  const next = setOnlineFeature('coachRefs',true);
  assert.deepEqual(next.features,{coach:false,coachRefs:true,ocrText:false,foodEstimate:false});
});
test('chat toggle and settings use the same choice in both directions', () => {
  useStore({[ONLINE_FEATURES_KEY]:saved({coach:true})});
  setOnline(false); assert.equal(onlineFeatures().features.coach,false);
  setOnlineFeature('coach',true); assert.equal(onlineSetting().on,true);
});
test('invalid saved booleans do not become permission; fresh defaults stay unchanged', () => {
  useStore({[ONLINE_FEATURES_KEY]:saved({coach:'false',coachRefs:1,ocrText:'yes',foodEstimate:1})});
  assert.equal(onlineFeatures().features.coach,false); assert.equal(onlineSetting().on,false); assert.equal(onlineFeatures().features.coachRefs,false);
  assert.equal(onlineFeatures().features.ocrText,false); assert.equal(onlineFeatures().features.foodEstimate,false);
  useStore({}); assert.deepEqual(onlineFeatures().features,{coach:true,coachRefs:true,ocrText:true,foodEstimate:true});
});
