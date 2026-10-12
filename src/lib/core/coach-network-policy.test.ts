import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorizeNetworkAction as allow, parseCoachNetworkMode as parse } from './coach-network-policy.ts'
test('defaults deny by design', () => { assert.equal(parse(null), 'local'); assert.equal(parse('random'), 'local') })
test('explicit public knowledge preference', () => assert.equal(parse('public-knowledge'), 'public-knowledge'))
test('local answers work offline', () => assert.equal(allow({mode:'local',action:'local-answer',online:false}).allowed,true))
test('public references disabled by default', () => assert.equal(allow({mode:'local',action:'open-public-reference'}).allowed,false))
test('public references blocked offline', () => assert.equal(allow({mode:'public-knowledge',action:'open-public-reference',online:false}).allowed,false))
test('public references allowed with preference', () => assert.equal(allow({mode:'public-knowledge',action:'open-public-reference',online:true}).allowed,true))
test('private data requires explicit consent', () => assert.equal(allow({mode:'public-knowledge',action:'send-private-data',online:true,serverAuthorized:true}).allowed,false))
test('private data requires server authorization', () => assert.equal(allow({mode:'public-knowledge',action:'send-private-data',online:true,explicitDataConsent:true}).allowed,false))
test('paid model requires server authorization', () => assert.equal(allow({mode:'public-knowledge',action:'invoke-paid-model',online:true,explicitDataConsent:true}).allowed,false))
test('fully authorized requests may proceed', () => assert.equal(allow({mode:'public-knowledge',action:'invoke-paid-model',online:true,explicitDataConsent:true,serverAuthorized:true}).allowed,true))
