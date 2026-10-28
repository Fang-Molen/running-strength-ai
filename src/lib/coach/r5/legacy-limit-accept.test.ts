import test from 'node:test';
import assert from 'node:assert/strict';
import { currentAthleteId, setEventContext } from '../../core/events';
import { setStoreBackend } from '../../core/storage';
import { appendJournal } from '../../core/storage-journal';
import { loadProfile, profileStorageKey } from '../../strength/profile';
import { decideR5Command, prepareR5Command, readR5Commands } from './host';

test('a legacy pending absence command cannot clear an active profile restriction at acceptance',async t=>{
  const previous=currentAthleteId(),values=new Map<string,string>(),now='2026-10-28T10:00:00.000Z';
  setStoreBackend({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v)},keys:()=>[...values.keys()]});
  setEventContext({athleteId:'SYN-LEGACY-RESTRICTION'});
  t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previous})});
  values.set(profileStorageKey(),JSON.stringify({limit:'医生要求暂停跑步',_savedAt:now}));
  const prepared=prepareR5Command('身体限制：医生要求暂停跑步',now);
  assert.equal(prepared.kind,'PROPOSAL');
  if(prepared.kind!=='PROPOSAL')return;
  // Model a previously persisted, otherwise valid card from the legacy parser.
  const legacy={...prepared.command,question:'身体限制：无',profile:{...prepared.command.profile!,patch:{limit:'无'}}};
  assert.equal(appendJournal(`fk-r5-command:${encodeURIComponent(currentAthleteId())}:`,`${legacy.id}:legacy`,legacy),true);
  assert.equal(readR5Commands().find(c=>c.id===legacy.id)?.profile?.patch.limit,'无');
  const result=await decideR5Command(legacy.id,'ACCEPT',now);
  assert.equal(result.ok,false);
  assert.equal(loadProfile().limit,'医生要求暂停跑步');
});
