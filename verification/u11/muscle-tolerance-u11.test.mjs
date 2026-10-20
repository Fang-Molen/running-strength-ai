import test from 'node:test';import assert from 'node:assert/strict';import {reviewMuscleTolerance} from '../../src/lib/health/muscle-tolerance-u11.ts';
const mk=(i,soreness=5,sets=3)=>({athleteId:'a',sessionId:'s'+i,region:'quads',protocolKey:'squat-v1',workoutAt:`2026-10-${String(i+1).padStart(2,'0')}T12:00:00Z`,knownAt:`2026-10-${String(i+2).padStart(2,'0')}T12:00:00Z`,actualSets:sets,nextDaySoreness:soreness});
const run=s=>reviewMuscleTolerance({athleteId:'a',region:'quads',protocolKey:'squat-v1',asOf:'2026-10-20T20:00:00Z',samples:s});
test('insufficient history gives no fake tolerance score',()=>{const r=run([mk(1),mk(2)]);assert.equal(r.state,'INSUFFICIENT');assert.equal(r.isMeasuredMuscleTolerance,false)});
test('comparable soreness trend is descriptive only',()=>{const r=run([mk(1,6),mk(2,6),mk(3,5),mk(4,4),mk(5,3),mk(6,3)]);assert.equal(r.state,'DESCRIPTIVE');assert.equal(r.delta,-3);assert.equal(r.isMeasuredMuscleTolerance,false)});
test('large set count change prevents comparison',()=>{const r=run([mk(1,6),mk(2,6),mk(3,5),mk(4,4,6),mk(5,3,6),mk(6,3,6)]);assert.equal(r.state,'NOT_COMPARABLE')});
test('other athlete excluded',()=>assert.equal(run([mk(1),mk(2),mk(3),mk(4),mk(5),{...mk(6),athleteId:'b'}]).state,'INSUFFICIENT'));
test('missing soreness not zero',()=>assert.equal(run([mk(1),mk(2),mk(3),mk(4),mk(5),mk(6, null)]).state,'INSUFFICIENT'));
test('same session revision deduped',()=>assert.equal(run([mk(1),mk(1,2),mk(2),mk(3),mk(4),mk(5)]).validN,5));
