/** Optional sync plan for the EXISTING authorized Garmin runner; do not add undocumented endpoints. */
export type Reason='FOREGROUND'|'PERIODIC'|'MANUAL'
export type Plan={mode:'DEFER'|'RECENT'|'FULL';offsets:number[];reason:string;backfillThrough:number;completeHistory:false}
const day=(s:string,n:number)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10)}
const stamp=(s:string|null)=>s?Date.parse(s):NaN
export function planGarminDailySync(i:{today:string;now:string;reason:Reason;lastAttemptAt:string|null;lastFullSuccessAt:string|null;lastFailureAt:string|null;backfillThrough:number;historyTarget?:number}):Plan{
 if(!/^\d{4}-\d\d-\d\d$/.test(i.today)||day(i.today,0)!==i.today||!Number.isFinite(Date.parse(i.now)))throw Error('INVALID_TIME')
 const now=Date.parse(i.now),age=(s:string|null)=>Number.isFinite(stamp(s))?Math.max(0,now-stamp(s)):Infinity
 if(i.reason!=='MANUAL'&&age(i.lastAttemptAt)<5*60000)return {mode:'DEFER',offsets:[],reason:'距离上次尝试不足5分钟，避免重复请求',backfillThrough:i.backfillThrough,completeHistory:false}
 if(i.reason!=='MANUAL'&&age(i.lastFailureAt)<30*60000)return {mode:'DEFER',offsets:[],reason:'近期同步失败，等待退避窗口',backfillThrough:i.backfillThrough,completeHistory:false}
 const full=i.reason==='MANUAL'||age(i.lastFullSuccessAt)>=24*3600000
 if(!full)return {mode:'RECENT',offsets:[0,1,2],reason:'最近3日增量；每日完整复核14日以接收迟到更正',backfillThrough:i.backfillThrough,completeHistory:false}
 const target=Math.min(90,Math.max(14,i.historyTarget??90)),from=Math.min(target,Math.max(14,i.backfillThrough)),to=Math.min(target,from+14)
 return {mode:'FULL',offsets:[...Array.from({length:14},(_,n)=>n),...Array.from({length:to-from},(_,n)=>from+n)],reason:'完整复核最近14日并逐批补历史，保存成功后才推进游标',backfillThrough:to,completeHistory:false}
}
