import { test } from "node:test"
import { strict as assert } from "node:assert"
import { arbitratePlanChange, type PlanChangeRequest } from "./adaptive-plan-permissions.ts"
const base: PlanChangeRequest = { daysAhead: 0, expectedRevision: 2, actualRevision: 2, reason: "训练前反馈", evidenceIds: ["feedback:1"], nextSessionIntensity: "HARD", proposedAction: "POSTPONE" }
test("today and tomorrow require user confirmation", () => { for (const daysAhead of [0,1]) assert.equal(arbitratePlanChange({...base,daysAhead}).status,"REQUIRE_CONFIRMATION") })
test("days 2-7 notify; later replan", () => { for (const daysAhead of [2,7]) assert.equal(arbitratePlanChange({...base,daysAhead}).status,"NOTIFY_BEFORE_CHANGE"); assert.equal(arbitratePlanChange({...base,daysAhead:8}).status,"REPLAN_REVIEW") })
test("hamstring discomfort before fast running forces safety review", () => { assert.equal(arbitratePlanChange({...base,discomfort:{region:"腘绳肌",severity:2,functionalLimitation:false}}).status,"SAFETY_REVIEW") })
test("functional limitation overrides notification and confirmation", () => { assert.equal(arbitratePlanChange({...base,daysAhead:5,nextSessionIntensity:"EASY",discomfort:{region:"腘绳肌",severity:1,functionalLimitation:true}}).status,"SAFETY_REVIEW") })
test("missing severity requires review", () => { assert.equal(arbitratePlanChange({...base,discomfort:{region:"腘绳肌",severity:null,functionalLimitation:null}}).status,"SAFETY_REVIEW") })
test("revision mismatch rejects changes", () => { assert.equal(arbitratePlanChange({...base,actualRevision:3}).status,"REJECT_CONFLICT") })
test("never silently changes a plan", () => { for (const daysAhead of [0,1,2,7,8]) assert.equal(arbitratePlanChange({...base,daysAhead}).canApplyAutomatically,false) })
test("rejects invalid evidence", () => { assert.throws(()=>arbitratePlanChange({...base,daysAhead:-1})); assert.throws(()=>arbitratePlanChange({...base,discomfort:{region:"leg",severity:11,functionalLimitation:false}})) })
