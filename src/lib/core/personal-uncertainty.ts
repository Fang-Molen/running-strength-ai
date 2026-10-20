/**
 * FK-U09 | Read-only personal statistics. No health diagnosis or plan write permission.
 * No external dependencies, no browser storage, no API calls.
 * All observations must be pre-scoped by the trusted host; this layer checks scope again.
 */
export type PersonalObservation = {
  observationId: string
  athleteId: string
  metric: string
  day: string
  value: number
  unit: string
  protocol: string
  sourceId: string
  revision: string
  recordedAt: string
  /** A daily measurement is not an intraday measurement. */
  kind: 'ACTUAL' | 'SELF_REPORT' | 'ESTIMATE'
}
export type ComparableSeries = {
  status: 'AVAILABLE' | 'INSUFFICIENT' | 'INVALID' | 'CONFLICT'
  points: PersonalObservation[]
  rejected: string[]
  conflictingDays: string[]
  sourceIds: string[]
  athleteId: string
  metric: string
  protocol: string
  unit: string
  asOf: string
  decisionAuthorized: false
}
export type Summary = {
  status: 'AVAILABLE' | 'INSUFFICIENT'
  n: number
  mean: number | null
  median: number | null
  sd: number | null
  cvPercent: number | null
  mad: number | null
  min: number | null
  max: number | null
  p10: number | null
  p90: number | null
  unit: string
  limitations: string[]
  decisionAuthorized: false
}
export type Trend = {
  status: 'AVAILABLE' | 'INSUFFICIENT' | 'ASSUMPTIONS_UNMET'
  n: number
  slopePerDay: number | null
  slopeCi95: [number, number] | null
  intercept: number | null
  rSquared: number | null
  residualSd: number | null
  durbinWatson: number | null
  predictedNext: number | null
  nextPredictionInterval95: [number, number] | null
  reason: string
  unit: string
  /** Conditional IID regression interval; never a validated athlete-specific forecast. */
  assumptions: string[]
  decisionAuthorized: false
}
export type ForecastAudit = {
  status: 'AVAILABLE' | 'INSUFFICIENT' | 'REVIEW_REQUIRED'
  calibrationN: number
  holdoutN: number
  nominalCoverage: number
  empiricalHoldoutCoverage: number | null
  holdoutMae: number | null
  nextPrediction: number | null
  nextInterval: [number, number] | null
  radius: number | null
  reason: string
  limitations: string[]
  decisionAuthorized: false
}

const dayValid = (day: string): boolean => /^\d{4}-\d\d-\d\d$/.test(day) && !Number.isNaN(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0,10) === day
const finite = (v: number): boolean => typeof v === 'number' && Number.isFinite(v)
const instant = (v: string): number => typeof v === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN
const mean = (a: readonly number[]): number => a.reduce((s,v)=>s+v,0)/a.length
const sorted = (a: readonly number[]): number[] => [...a].sort((x,y)=>x-y)
const median = (a: readonly number[]): number => { const b=sorted(a); const i=Math.floor(b.length/2); return b.length%2 ? b[i] : (b[i-1]+b[i])/2 }
const quantile = (a: readonly number[],p: number): number => {const b=sorted(a),k=(b.length-1)*p,i=Math.floor(k);return b[i]+(b[Math.min(i+1,b.length-1)]-b[i])*(k-i)}
const variance = (a: readonly number[]): number => {const m=mean(a);return a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1)}
const dayIndex = (day:string):number => Date.parse(day+'T00:00:00Z')/86400000

/** Rejects duplicates and conflicting same-day measurements; does not average devices or invent zeros. */
export function selectComparableSeries(input: {
  observations: readonly PersonalObservation[]
  athleteId: string
  metric: string
  protocol: string
  unit: string
  asOf: string
  onePerDay?: boolean
}): ComparableSeries {
  const {observations,athleteId,metric,protocol,unit,asOf}=input
  const out:ComparableSeries={status:'INVALID',points:[],rejected:[],conflictingDays:[],sourceIds:[],athleteId,metric,protocol,unit,asOf,decisionAuthorized:false}
  const now=instant(asOf)
  if(!athleteId.trim()||!metric.trim()||!protocol.trim()||!unit.trim()||!finite(now))return out
  const byId=new Map<string,PersonalObservation[]>()
  for(const o of observations){
    if(o.athleteId!==athleteId||o.metric!==metric||o.protocol!==protocol||o.unit!==unit)continue
    if(!o.observationId||!o.sourceId||!o.revision||!dayValid(o.day)||!finite(o.value)||!finite(instant(o.recordedAt))||instant(o.recordedAt)>now||o.day>asOf.slice(0,10)||o.kind==='ESTIMATE'){
      out.rejected.push(o.observationId||'INVALID_ID');continue
    }
    byId.set(o.observationId,[...(byId.get(o.observationId)??[]),o])
  }
  const unique:PersonalObservation[]=[]
  for(const [id,rows] of byId){
    const r=rows[0]
    if(rows.some(v=>JSON.stringify(v)!==JSON.stringify(r))){out.rejected.push('CONFLICT_ID:'+id);continue}
    unique.push(r)
  }
  const days=new Map<string,PersonalObservation[]>()
  for(const p of unique)days.set(p.day,[...(days.get(p.day)??[]),p])
  for(const [day,rows] of days){
    if(input.onePerDay!==false && rows.length>1){out.conflictingDays.push(day);continue}
    out.points.push(...rows)
  }
  out.points.sort((a,b)=>a.day.localeCompare(b.day)||a.observationId.localeCompare(b.observationId))
  out.sourceIds=[...new Set(out.points.map(p=>p.sourceId))].sort()
  out.status=out.conflictingDays.length||out.rejected.some(s=>s.startsWith('CONFLICT_ID'))?'CONFLICT':out.points.length>=2?'AVAILABLE':'INSUFFICIENT'
  return out
}

export function summarizeSeries(series:ComparableSeries):Summary {
  const vals=series.points.map(p=>p.value)
  const limitations=['描述性统计；没有医学诊断、训练许可或自动改课权限。','样本日之间可能相关；分位数不是预测区间。']
  if(series.conflictingDays.length)limitations.push('存在未解决的同日来源冲突，已排除这些日期。')
  if(series.status==='INVALID'||series.status==='CONFLICT'||vals.length<3)return {status:'INSUFFICIENT',n:vals.length,mean:null,median:null,sd:null,cvPercent:null,mad:null,min:null,max:null,p10:null,p90:null,unit:series.unit,limitations,decisionAuthorized:false}
  const m=mean(vals),sd=Math.sqrt(variance(vals)),med=median(vals)
  return {status:'AVAILABLE',n:vals.length,mean:m,median:med,sd,cvPercent:m===0?null:100*sd/Math.abs(m),mad:median(vals.map(x=>Math.abs(x-med))),min:Math.min(...vals),max:Math.max(...vals),p10:quantile(vals,.1),p90:quantile(vals,.9),unit:series.unit,limitations,decisionAuthorized:false}
}

// Exact 0.975 quantiles for integer df=1..200; asymptotic Cornish-Fisher for df>200.
const T_CRITICAL_95 = [12.706204736175, 4.302652729749, 3.182446305284, 2.776445105198, 2.570581835636, 2.446911851145, 2.364624251593, 2.306004135204, 2.262157162798, 2.228138851986, 2.200985160092, 2.178812829667, 2.160368656463, 2.144786687918, 2.131449545560, 2.119905299221, 2.109815577833, 2.100922040241, 2.093024054408, 2.085963447266, 2.079613844728, 2.073873067904, 2.068657610419, 2.063898561628, 2.059538552753, 2.055529438643, 2.051830516480, 2.048407141795, 2.045229642133, 2.042272456301, 2.039513446396, 2.036933343460, 2.034515297449, 2.032244509318, 2.030107928250, 2.028094000980, 2.026192463029, 2.024394163912, 2.022690920037, 2.021075390306, 2.019540970441, 2.018081702818, 2.016692199228, 2.015367574444, 2.014103388881, 2.012895598919, 2.011740513730, 2.010634757624, 2.009575237129, 2.008559112101, 2.007583770316, 2.006646805062, 2.005745995318, 2.004879288188, 2.004044783289, 2.003240718848, 2.002465459291, 2.001717484145, 2.000995378088, 2.000297822014, 1.999623584995, 1.998971517033, 1.998340542521, 1.997729654318, 1.997137908392, 1.996564418952, 1.996008354025, 1.995468931430, 1.994945415107, 1.994437111771, 1.993943367846, 1.993463566662, 1.992997125890, 1.992543495181, 1.992102154002, 1.991672609645, 1.991254395388, 1.990847068812, 1.990450210230, 1.990063421254, 1.989686323457, 1.989318557137, 1.988959780175, 1.988609666976, 1.988267907477, 1.987934206239, 1.987608281589, 1.987289864831, 1.986978699506, 1.986674540704, 1.986377154419, 1.986086316951, 1.985801814346, 1.985523441867, 1.985251003505, 1.984984311522, 1.984723186014, 1.984467454508, 1.984216951586, 1.983971518524, 1.983731002956, 1.983495258563, 1.983264144773, 1.983037526484, 1.982815273795, 1.982597261766, 1.982383370176, 1.982173483308, 1.981967489736, 1.981765282132, 1.981566757075, 1.981371814876, 1.981180359415, 1.980992297976, 1.980807541104, 1.980626002459, 1.980447598683, 1.980272249273, 1.980099876457, 1.979930405082, 1.979763762505, 1.979599878487, 1.979438685093, 1.979280116605, 1.979124109424, 1.978970601991, 1.978819534703, 1.978670849838, 1.978524491479, 1.978380405447, 1.978238539230, 1.978098841924, 1.977961264168, 1.977825758087, 1.977692277239, 1.977560776559, 1.977431212308, 1.977303542028, 1.977177724490, 1.977053719657, 1.976931488634, 1.976810993633, 1.976692197930, 1.976575065830, 1.976459562633, 1.976345654594, 1.976233308895, 1.976122493614, 1.976013177689, 1.975905330897, 1.975798923818, 1.975693927815, 1.975590315005, 1.975488058234, 1.975387131055, 1.975287507703, 1.975189163077, 1.975092072712, 1.974996212767, 1.974901560001, 1.974808091752, 1.974715785924, 1.974624620966, 1.974534575858, 1.974445630092, 1.974357763658, 1.974270957028, 1.974185191143, 1.974100447399, 1.974016707631, 1.973933954103, 1.973852169495, 1.973771336888, 1.973691439756, 1.973612461954, 1.973534387706, 1.973457201594, 1.973380888549, 1.973305433841, 1.973230823072, 1.973157042159, 1.973084077336, 1.973011915136, 1.972940542389, 1.972869946211, 1.972800113995, 1.972731033409, 1.972662692381, 1.972595079100, 1.972528182001, 1.972461989767, 1.972396491316, 1.972331675796, 1.972267532582, 1.972204051268, 1.972141221662, 1.972079033779, 1.972017477836, 1.971956544252, 1.971896223634]
function tCritical95(df:number):number{
  if(df<=200)return T_CRITICAL_95[df-1]
  const z=1.959963984540054, n=df
  return z+(z**3+z)/(4*n)+(5*z**5+16*z**3+3*z)/(96*n**2)+(3*z**7+19*z**5+17*z**3-15*z)/(384*n**3)+(79*z**9+776*z**7+1482*z**5-1920*z**3-945*z)/(92160*n**4)
}
/** OLS trend. Conditional t intervals suppressed for strong residual serial correlation. */
export function fitIndependentTrend(series:ComparableSeries):Trend {
  const n=series.points.length
  const base:Trend={status:'INSUFFICIENT',n,slopePerDay:null,slopeCi95:null,intercept:null,rSquared:null,residualSd:null,durbinWatson:null,predictedNext:null,nextPredictionInterval95:null,reason:'NEED_8_COMPARABLE_OBSERVATIONS',unit:series.unit,assumptions:['相同设备/协议、可比任务；OLS残差独立、同方差、近似正态；非因果解释。'],decisionAuthorized:false}
  if(series.status==='INVALID'||series.status==='CONFLICT')return {...base,reason:'SOURCE_OR_SCOPE_CONFLICT'}
  if(n<8||new Set(series.points.map(p=>p.day)).size!==n)return base
  const xs=series.points.map(p=>dayIndex(p.day)-dayIndex(series.points[0].day)), ys=series.points.map(p=>p.value)
  const mx=mean(xs),my=mean(ys),sxx=xs.reduce((s,x)=>s+(x-mx)**2,0)
  if(sxx<=0)return {...base,reason:'NO_TIME_SPREAD'}
  const slope=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0)/sxx, intercept=my-slope*mx
  const residuals=xs.map((x,i)=>ys[i]-intercept-slope*x),rss=residuals.reduce((s,e)=>s+e*e,0)
  const sst=ys.reduce((s,y)=>s+(y-my)**2,0),df=n-2,sigma=Math.sqrt(rss/df)
  const dw=rss>1e-12?residuals.slice(1).reduce((s,e,i)=>s+(e-residuals[i])**2,0)/rss:null
  const nextX=xs.at(-1)!+1, prediction=intercept+slope*nextX
  const common={...base,slopePerDay:slope,intercept,rSquared:sst>0?1-rss/sst:null,residualSd:sigma,durbinWatson:dw,predictedNext:prediction}
  if(dw===null||dw<1.2||dw>2.8)return {...common,status:'ASSUMPTIONS_UNMET',predictedNext:null,reason:'SERIAL_CORRELATION_OR_DEGENERATE_RESIDUALS'}
  const t=tCritical95(df),seSlope=sigma/Math.sqrt(sxx),sePred=sigma*Math.sqrt(1+1/n+(nextX-mx)**2/sxx)
  return {...common,status:'AVAILABLE',slopeCi95:[slope-t*seSlope,slope+t*seSlope],nextPredictionInterval95:[prediction-t*sePred,prediction+t*sePred],reason:'CONDITIONAL_IID_INTERVALS_ONLY'}
}

/** Chronological split-conformal audit; no shuffle, no future leakage.
 * Even if empirical coverage looks good, time dependence or drift breaks exchangeability.
 */
export function auditRollingForecast(series:ComparableSeries, opts:{window?:number;alpha?:number;holdoutFraction?:number}={}):ForecastAudit {
  const window=opts.window??5,alpha=opts.alpha??.05,frac=opts.holdoutFraction??.2
  const base:ForecastAudit={status:'INSUFFICIENT',calibrationN:0,holdoutN:0,nominalCoverage:1-alpha,empiricalHoldoutCoverage:null,holdoutMae:null,nextPrediction:null,nextInterval:null,radius:null,reason:'INSUFFICIENT_HISTORY',limitations:['时间顺序校准；不随机打乱。','区间依赖未来误差与历史可交换性；自相关、趋势突变、测量变更可能导致失准。','覆盖率是历史留出段实测，不是未来覆盖保证。','只读研究结果，不授权训练处方。'],decisionAuthorized:false}
  if(series.status!=='AVAILABLE'||!Number.isInteger(window)||window<2||window>30||!(alpha>0&&alpha<.5)||!(frac>.05&&frac<.5))return {...base,reason:'INVALID_INPUT_OR_SOURCE_CONFLICT'}
  const vals=series.points.map(p=>p.value), n=vals.length
  if(series.points.some((p,i)=>i>0&&dayIndex(p.day)-dayIndex(series.points[i-1].day)!==1))return {...base,reason:'GAPS_IN_DAILY_SERIES'}
  const holdout=Math.max(5,Math.floor(n*frac)), cutoff=n-holdout
  if(cutoff<=window)return base
  const errors:number[]=[]
  for(let i=window;i<cutoff;i++)errors.push(Math.abs(vals[i]-mean(vals.slice(i-window,i))))
  const rank=Math.ceil((errors.length+1)*(1-alpha))
  if(errors.length<19||rank>errors.length)return {...base,calibrationN:errors.length,holdoutN:holdout,reason:'CALIBRATION_SAMPLE_TOO_SMALL_FOR_REQUESTED_COVERAGE'}
  const radius=sorted(errors)[rank-1]
  const forecasts=vals.slice(cutoff).map((v,j)=>mean(vals.slice(cutoff+j-window,cutoff+j)))
  const held=vals.slice(cutoff)
  const hits=held.filter((v,j)=>Math.abs(v-forecasts[j])<=radius).length
  const mae=mean(held.map((v,j)=>Math.abs(v-forecasts[j])))
  const next=mean(vals.slice(-window))
  // 80% is a product QA review trigger, NOT a physiological or calibrated coverage threshold.
  // Poor held-out coverage blocks presentation of a prospective interval.
  if(hits/holdout<.8)return {...base,status:'REVIEW_REQUIRED',calibrationN:errors.length,holdoutN:holdout,empiricalHoldoutCoverage:hits/holdout,holdoutMae:mae,radius,reason:'HOLDOUT_COVERAGE_BELOW_QA_TRIGGER'}
  return {...base,status:'AVAILABLE',calibrationN:errors.length,holdoutN:holdout,empiricalHoldoutCoverage:hits/holdout,holdoutMae:mae,nextPrediction:next,nextInterval:[next-radius,next+radius],radius,reason:'HISTORICAL_SPLIT_CONFORMAL_ONLY'}
}

/** Paired comparison of two *matched*, independently observed protocols; not a treatment effect. */
export function pairedDifference95(pairs:readonly {before:number;after:number;pairId:string}[],unit:string){
  const ids=new Set(pairs.map(p=>p.pairId))
  if(pairs.length<8||ids.size!==pairs.length||pairs.some(p=>!p.pairId||!finite(p.before)||!finite(p.after)))return {status:'INSUFFICIENT' as const,n:pairs.length,meanDifference:null,ci95:null,unit,decisionAuthorized:false as const}
  const diff=pairs.map(p=>p.after-p.before),m=mean(diff),se=Math.sqrt(variance(diff)/diff.length),t=tCritical95(diff.length-1)
  return {status:'AVAILABLE' as const,n:pairs.length,meanDifference:m,ci95:[m-t*se,m+t*se] as [number,number],unit,decisionAuthorized:false as const,limitations:'配对差的模型置信区间；需配对独立、同协议、近似正态。非随机对照不证明因果。'}
}
