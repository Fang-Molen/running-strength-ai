import assert from "node:assert/strict";
import { test } from "node:test";
import { currentWeekGrowth } from "./athlete-growth.ts";

test("empty data never grants online entitlement", () => {
 const result = currentWeekGrowth({cycle: undefined});
 assert.equal(result.xp, 0);
 assert.equal(result.levelFiveEligible, false);
});
test("editing same session does not earn extra XP", () => {
 const result = currentWeekGrowth({cycle:{block:1,week:1,lastChange:"",logs:[
  {sessionId:"a",feel:"ok",painIds:[],note:""},
  {sessionId:"a",feel:"hard",painIds:[],note:""},
  {sessionId:"b",feel:"skip",painIds:[],note:""},
 ]}});
 assert.equal(result.xp, 20);
 assert.equal(result.feedbackCount, 1);
 assert.equal(result.recoveryCount, 1);
});
