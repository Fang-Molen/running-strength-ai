/** Bounded descriptive arithmetic on user utterances, never saved training or a prescription.
 * No benchmark IDs, reference answers, eval, inferred repetitions or future dose. */
export function questionCalculations(question:string,prior:readonly string[]=[]):{id:string;kind:'FACT';detail:string}[]{
 const normalize=(s:string)=>s.normalize('NFKC').replace(/(前|第)([一二三四五六七八九十])组/g,(_m,p,n)=>p+String('一二三四五六七八九十'.indexOf(n)+1)+'组');
 const q=normalize(question),out:string[]=[];
 const add=(s:string)=>{if(!out.includes(s)&&s.length<400)out.push(s+'（按用户自述计算，未核验、未写入记录，不代表完整覆盖或生理结论。）')};
 const sum=(xs:number[])=>Number(xs.reduce((a,b)=>a+b,0).toFixed(6));
 const numberList=(input:string)=>{const s=input.replaceAll('秒','');return /^[\d.、,，/和及\s]+$/.test(s)?s.match(/\d+(?:\.\d+)?/g)?.map(Number)??[]:[]};
 const finite=(xs:number[])=>xs.length>0&&xs.length<=100&&xs.every(n=>Number.isFinite(n)&&n>=0&&n<1e7);
 const duration=(n:number)=>`${n}秒（${Math.floor(n/60)}分${Number((n%60).toFixed(3))}秒）`;
 // Separate per-segment distance and duration lists; no rest is ever added.
 const separate=q.match(/((?:\d+(?:\.\d+)?\s*米[、,，和及\s]*){2,})分别用时((?:\d+(?:\.\d+)?\s*秒[、,，和及\s]*){2,})/);
 if(separate){const d=[...separate[1].matchAll(/(\d+(?:\.\d+)?)\s*米/g)].map(m=>+m[1]),t=[...separate[2].matchAll(/(\d+(?:\.\d+)?)\s*秒/g)].map(m=>+m[1]);if(d.length===t.length&&finite(d)&&finite(t))add(`总距离${sum(d)}米；已知工作时间${duration(sum(t))}，不含休息`)}
 // Explicit repeated distance + only the reported timings, including partial completion.
 const repeats=q.match(/(\d+)\s*[×x*]\s*(\d+(?:\.\d+)?)米/),timings=q.match(/(?:前\d+组(?:是|为)?|成绩(?:依次)?(?:是|为))([\d.、,，/和秒\s]+)秒/);
 if(repeats&&timings){const ts=numberList(timings[1]);const last=q.match(/第\d+组(?:做了|用时|是|为)(\d+(?:\.\d+)?)秒/);if(last)ts.push(+last[1]);const completed=q.match(/第(\d+)组(?:已)?完成(?![?？])/),n=+repeats[1];const prefix=completed?(q.slice(0,completed.index).split(/[，,。；;]/).at(-1)??''):'';const completedWithoutTime=completed&&+completed[1]===n&&ts.length===n-1&&!/(?:不确定|不能确认|不清楚|尚未确认|想知道)$/.test(prefix)&&!/[吗?？]/.test(q.slice(completed.index,(completed.index??0)+completed[0].length+3));
  if(finite(ts)&&ts.length<=n)add(`已知完成${(completedWithoutTime?n:ts.length)*+repeats[2]}米；已知工作时间${duration(sum(ts))}；${completedWithoutTime?'各组完成状态明确，最后一组未计时，总工作时间未知':ts.length<n?'其余组完成状态未知，不按零或完成处理':'所述各组均有时间记录'}`)}
 // Equal-distance repetitions and an explicitly indexed correction preserve old total.
 const series=(s:string)=>s.match(/(?:成绩(?:依次)?(?:是|为)|成绩依次为)([\d.、,，/和秒\s]+)秒/);
 const own=series(q);
 if(!repeats&&own){const ts=numberList(own[1]);if(finite(ts))add(`所述各组工作时间合计${duration(sum(ts))}；首组${ts[0]}秒，末组${ts.at(-1)}秒；时间${ts.at(-1)!>ts[0]?'增加':ts.at(-1)!<ts[0]?'减少':'相同'}，不能据此证明原因`)}
 const corrections=(s:string)=>[...s.matchAll(/第(\d+)组(?:实际)?(?:是|为|改为|改)?(\d+(?:\.\d+)?)秒/g)];
 const current=corrections(q);
 if(current.length&&/更正|记错|更新|其他.*不变/.test(q)){
  const events=prior.map(normalize);let at=-1;events.forEach((s,i)=>{if(series(s))at=i;});
  if(at>=0){const ts=numberList(series(events[at])![1]);
   for(const event of events.slice(at+1))if(/更正|记错|更新|其他.*不变/.test(event))for(const update of corrections(event))if(+update[1]>=1&&+update[1]<=ts.length)ts[+update[1]-1]=+update[2];
   if(finite(ts)&&current.every(m=>+m[1]>=1&&+m[1]<=ts.length)){
    const old=sum(ts),changes:string[]=[];for(const update of current){const i=+update[1]-1,oldValue=ts[i];ts[i]=+update[2];changes.push(`更正第${i+1}组由${oldValue}秒为${ts[i]}秒`);}
    add(`旧总时间${old}秒；${changes.join('；')}，新总时间${sum(ts)}秒；其余组不变，旧自述保留，未改写已保存记录`);
   }
  }
 }
 const minutes=q.match(/(?:训练总时长|总时长|整课时长)\s*(\d+(?:\.\d+)?)分钟/),rpe=q.match(/整课\s*RPE(?:为|是)?\s*(\d+(?:\.\d+)?)/i);
 if(minutes&&rpe&&/(?:0\s*[–—-]\s*10|0到10|0至10)/.test(q)&&+rpe[1]<=10&&!/整课.*(?:未知|没填|未填)/.test(q))add(`整课主观负荷${+minutes[1]}分钟×${+rpe[1]}=${+minutes[1]*+rpe[1]} AU；仅为主观负荷，不能表示疲劳百分比`);
 // Keep planned and completed strength sets separate and keep per-hand load basis.
 const hand=q.match(/每手\s*(\d+(?:\.\d+)?)\s*(?:公斤|千克)/),reps=q.match(/每组\s*(\d+)次/),sets=q.match(/实际完成\s*(\d+)组/);
 if(hand&&reps&&sets)add(`实际完成${+sets[1]}组、${+sets[1]*+reps[1]}次；每只手负重次数积${+hand[1]*+sets[1]*+reps[1]} kg·次；跳过的组不计入完成`);
 // Directly paired distances/durations, arbitrary distances and order.
 const pace=[...q.matchAll(/([A-Za-z\u4e00-\u9fff]{1,6})?跑\s*(\d+(?:\.\d+)?)\s*(公里|千米|米|km|m)(?:用时|用)?\s*(\d+(?:\.\d+)?)\s*(?:分钟|min)/gi)].filter(m=>+m[2]>0);
 if(pace.length>=2||pace.length===1&&/配速/.test(q)){const ps=pace.map(m=>+m[4]*60/(+m[2]*(/^(?:米|m)$/i.test(m[3])?.001:1))),format=(n:number)=>{const t=Math.round(n);return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}/km`},name=(i:number)=>pace[i][1]??'第'+(i+1)+'次';
  const tied=ps.every(p=>p===ps[0]),best=ps.indexOf(Math.min(...ps)),displayTied=new Set(ps.map(format)).size===1;
  add(pace.map((m,i)=>`${name(i)}平均配速${format(ps[i])}`).join('；')+(pace.length<2?'':tied?'；平均配速相同，并列，无更快者':displayTied?`；显示相同，按原始精度${name(best)}略快；差异很小，需考虑测量分辨率`:`；${name(best)}用时每公里较少、更快`)+`；条件未必相同，不证明疲劳因果`)}
 const year=q.match(/(?:只求|求|计算|统计|汇总)\s*(20\d{2})年/),dated=[...q.matchAll(/(20\d{2})-\d{2}-\d{2}跑\s*(\d+(?:\.\d+)?)公里/g)];
 if(year&&dated.length){const ds=dated.filter(m=>m[1]===year[1]);add(`${year[1]}年已记录${sum(ds.map(m=>+m[2]))}公里；计入${ds.length}条所述记录，不能证明全年实际训练全部记录齐全`)}
 const calories=[...q.matchAll(/记录了\s*(\d+(?:\.\d+)?)千卡/g)].map(m=>+m[1]);
 const recorded=q.match(/已记录\s*((?:\d+(?:\.\d+)?\s*(?:公里|千米|km)[、,，和及\s]*){2,})/i);
 if(recorded){const values=[...recorded[1].matchAll(/(\d+(?:\.\d+)?)\s*(?:公里|千米|km)/gi)].map(m=>+m[1]);if(finite(values))add(`题面所述已记录距离合计${sum(values)}公里；只能说明这些记录的合计，不能证明全年实际训练记录齐全`);}
 if(calories.length)add(`已记录摄入${sum(calories)}千卡；${/还没记录|未记录|没记录/.test(q)?'全天完整性未知，不将未记录餐次补零':'按用户明确提供的餐次声明核对全天覆盖，不替代独立验证'}`);
 return out.slice(0,8).map((detail,i)=>({id:`question:calculation:${i}`,kind:'FACT',detail}));
}
