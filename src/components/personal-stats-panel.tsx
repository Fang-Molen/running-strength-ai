/** V89: concise, expandable projection of existing U09 research statistics. No new scores or writes. */
import { loadHealthSnapshot } from '@/lib/health/snapshot';
import { currentAthleteId } from '@/lib/core/events';
import { personalStatsCards } from '@/lib/health/personal-stats-host';
const STATUS: Record<string,string> = {DATA_CONFLICT:'来源待核对',HISTORY_ONLY:'历史参考',NEED_MORE_DATA:'数据不足',DESCRIPTIVE:'可比历史',STATISTICAL_REVIEW:'预测待校准'};
export function PersonalStatsPanel({day,className='home-card mt-3 p-3'}:{day:string;revision?:number;className?:string}){
 let cards:ReturnType<typeof personalStatsCards>=[];
 try {cards=personalStatsCards(loadHealthSnapshot(day),currentAthleteId(),`${day}T23:59:59`)} catch {cards=[]}
 const comparable=cards.filter(c=>c.status==='DESCRIPTIVE'||c.status==='HISTORY_ONLY').length;
 return <details className={className} data-testid="u09-stats">
  <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 text-sm font-bold"><span>个人趋势与波动</span><span className="text-sm font-normal text-muted">{comparable ? `${comparable}项有可比历史` : '等待可比记录'} ›</span></summary>
  <div className="mt-2 space-y-2" aria-label="个人统计详情">
   {cards.length ? cards.map(c=><details key={c.metric} className="rounded-xl border border-line p-3" data-testid={`u09-${c.metric}`}>
    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-bold"><span>{c.name}</span><span className="text-sm font-normal text-muted">{STATUS[c.status]??'待核对'} ›</span></summary>
    <div className="space-y-2 pt-2 text-sm leading-relaxed">
     {c.lines.map((line,i)=><p key={i} className="keep break-words">{line}</p>)}
     {c.caveats.length ? <details className="rounded-lg bg-surface-2 p-2"><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">查看适用条件与限制</summary>{c.caveats.map((line,i)=><p key={i} className="keep mt-1 text-sm text-muted">{line}</p>)}</details> : null}
    </div>
   </details>) : <p className="text-sm text-muted">统计记录暂不可读，不等于身体状态正常。</p>}
   <p className="keep text-sm text-muted">只比较同来源、同口径的历史。区间是研究性统计描述，不代表恢复许可或自动改课。</p>
  </div>
 </details>
}
