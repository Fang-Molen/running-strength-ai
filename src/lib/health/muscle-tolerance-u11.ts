import type {Region} from './muscle-recovery-u11'
/** Within-person comparable-session observation; not a calibrated tissue tolerance measurement. */
export type ToleranceSample={athleteId:string;sessionId:string;region:Region;protocolKey:string;workoutAt:string;knownAt:string;actualSets:number;nextDaySoreness:number|null;revision?:number}
export type ToleranceReview={state:'INSUFFICIENT'|'NOT_COMPARABLE'|'DESCRIPTIVE';region:Region;protocolKey:string;validN:number;firstMedianSoreness:number|null;recentMedianSoreness:number|null;delta:number|null;note:string;isMeasuredMuscleTolerance:false}
const median=(a:number[])=>{const x=[...a].sort((a,b)=>a-b);return x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2}
export function reviewMuscleTolerance(i:{athleteId:string;region:Region;protocolKey:string;asOf:string;samples:ToleranceSample[]}):ToleranceReview{
 if(!i.athleteId||!i.protocolKey||!Number.isFinite(Date.parse(i.asOf)))throw Error('INVALID_CONTEXT')
 const valid=i.samples.filter(s=>s.athleteId===i.athleteId&&s.region===i.region&&s.protocolKey===i.protocolKey&&s.sessionId&&Number.isFinite(Date.parse(s.workoutAt))&&Number.isFinite(Date.parse(s.knownAt))&&Date.parse(s.workoutAt)<=Date.parse(s.knownAt)&&Date.parse(s.knownAt)<=Date.parse(i.asOf)&&Number.isInteger(s.actualSets)&&s.actualSets>0&&s.nextDaySoreness!=null&&Number.isFinite(s.nextDaySoreness)&&s.nextDaySoreness>=0&&s.nextDaySoreness<=10)
 const byId=new Map<string,ToleranceSample>()
 for(const s of valid){const old=byId.get(s.sessionId);if(!old||(s.revision??0)>(old.revision??0))byId.set(s.sessionId,s)}
 const xs=[...byId.values()].sort((a,b)=>Date.parse(a.workoutAt)-Date.parse(b.workoutAt)),n=xs.length
 const base={region:i.region,protocolKey:i.protocolKey,validN:n,firstMedianSoreness:null,recentMedianSoreness:null,delta:null,isMeasuredMuscleTolerance:false} as const
 if(n<6)return {...base,state:'INSUFFICIENT' as const,note:`仅${n}次可比训练且有次日酸痛记录，不能推断个人肌肉耐受变化。`}
 const six=xs.slice(-6),a=six.slice(0,3),b=six.slice(3),loadA=median(a.map(x=>x.actualSets)),loadB=median(b.map(x=>x.actualSets))
 if(Math.abs(loadB-loadA)/loadA>0.2)return {...base,state:'NOT_COMPARABLE' as const,note:'前后实际组次差异较大，酸痛变化不能当作相似负荷下的适应趋势。'}
 const first=median(a.map(x=>x.nextDaySoreness!)),recent=median(b.map(x=>x.nextDaySoreness!))
 return {...base,state:'DESCRIPTIVE' as const,firstMedianSoreness:first,recentMedianSoreness:recent,delta:recent-first,note:`相似动作与组次下，最近三次次日酸痛中位数比前三次${recent===first?'未变化':recent<first?`低${(first-recent).toFixed(1)}分`:`高${(recent-first).toFixed(1)}分`}；这只是自报趋势，不证明肌肉组织恢复或力量耐受能力提高。`}
}
