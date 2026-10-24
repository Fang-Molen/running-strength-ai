import {validateProfile,type PersonalProfile} from '../personal/planner'
import {analysisDigest} from '../../health/analysis-evidence'

export type R4ConditionInput={athleteId:string;asOf:string;profile:PersonalProfile|null;profileSavedAt:string|null;feedback:readonly {at:string;value:{pain:boolean}}[]}
/** Local saved user declarations, not clinical clearance or model-supplied authority. */
export function resolveR4Conditions(input:R4ConditionInput){
 const reasons:string[]=[],p=input.profile,now=Date.parse(input.asOf),saved=Date.parse(input.profileSavedAt??'')
 let valid=false
 try{if(p){validateProfile(p);valid=p.athleteId===input.athleteId&&p.revision>0}}catch{/* preserve invalid source for user correction */}
 if(!valid)reasons.push('尚无当前运动员确认保存的有效个人条件')
 const fresh=Number.isFinite(now)&&Number.isFinite(saved)&&saved<=now&&now-saved<=30*86400000
 if(!fresh)reasons.push('个人条件尚未保存或超过30天需复核')
 const feedback=input.feedback.filter(f=>Number.isFinite(Date.parse(f.at))&&Date.parse(f.at)<=now).at(-1)
 const restricted=!!p&&(p.screen==='MEDICAL'||p.screen==='PAIN'||p.age!==null&&p.age<18)||feedback?.value.pain===true
 if(restricted)reasons.push('未成年、当前疼痛或特殊健康情况不适用通用健康成人方案')
 if(p?.age==null||p?.screen==='UNKNOWN')reasons.push('请确认年龄与当前健康筛查；缺失不推断为健康成人')
 const population=valid&&fresh&&!restricted&&p!.age!==null&&p!.age>=18&&p!.screen==='CLEAR'?'healthy_adult' as const:restricted?'special' as const:'unknown' as const
 return {population,profile:valid&&fresh?p:null,reasons,source:valid?{id:'personal-profile:'+input.athleteId,revision:p!.revision,savedAt:input.profileSavedAt,kind:'USER_CONFIRMED_LOCAL' as const}:null,
  version:analysisDigest([input.athleteId,p,input.profileSavedAt,feedback,population,reasons]),medicalClearance:false as const}
}
