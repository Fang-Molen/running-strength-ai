import {interpretCoachModelOutput,type AskCoachData} from './coach-pipeline'
/** One bounded provider-independent repair attempt. Emergencies always remain local. */
export async function reviewWithOneRepair(data:AskCoachData,raw:string,repair:(flags:string[])=>Promise<string>){
 const first=interpretCoachModelOutput(data,raw)
 const needsRepair=first.v4.flags.some(f=>/MODEL_SCHEMA_INVALID|DIAGNOSIS_WORDING|UNVERIFIED_|UNSUPPORTED_|UNKNOWN_OR_REVOKED|NEGATED_REFERRAL/.test(f))||first.v4.status==='BASE_GUARD_REJECTED'
 if(!needsRepair||first.v4.flags.includes('RED_FLAG_PRE_AND_POST'))return {...first,repair:{attempts:0,initialFlags:first.v4.flags,failed:false}}
 try{
  const next=interpretCoachModelOutput(data,await repair(first.v4.flags))
  return {...next,repair:{attempts:1,initialFlags:first.v4.flags,failed:next.v4.status!=='PASSED_STRUCTURAL_GUARD'||next.v4.flags.includes('DIAGNOSIS_WORDING_FILTERED')}}
 }catch{return {...first,repair:{attempts:1,initialFlags:first.v4.flags,failed:true}}}
}
