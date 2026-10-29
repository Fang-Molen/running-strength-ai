/** Bounded descriptive arithmetic on user utterances, never saved training or a prescription.
 * No benchmark IDs, reference answers, eval, inferred repetitions or future dose. */
export function questionCalculations(question:string,prior:readonly string[]=[]):{id:string;kind:'FACT';detail:string}[]{
 const q=question.normalize('NFKC'),out:string[]=[];
 const add=(s:string)=>{if(!out.includes(s)&&s.length<400)out.push(s+'（按用户自述计算，未核验、未写入记录，不代表完整覆盖或生理结论。）')};
 const sum=(xs:number[])=>Number(xs.reduce((a,b)=>a+b,0).toFixed(6));
 const numberList=(input:string)=>{const s=input.replaceAll('秒','');return /^[\d.、,，和及\s]+$/.test(s)?s.match(/\d+(?:\.\d+)?/g)?.map(Number)??[]:[]};
 const finite=(xs:number[])=>xs.length>0&&xs.length<=100&&xs.every(n=>Number.isFinite(n)&&n>=0&&n<1e7);
 const duration=(n:number)=>`${n}秒（${Math.floor(n/60)}分${Number((n%60).toFixed(3))}秒）`;
 // Separate per-segment distance and duration lists; no rest is ever added.
 const separate=q.match(/((?:\d+(?:\.\d+)?\s*米[、,，和及\s]*){2,})分别用时((?:\d+(?:\.\d+)?\s*秒[、,，和及\s]*){2,})/);
 if(separate){const d=[...separate[1].matchAll(/(\d+(?:\.\d+)?)\s*米/g)].map(m=>+m[1]),t=[...separate[2].matchAll(/(\d+(?:\.\d+)?)\s*秒/g)].map(m=>+m[1]);if(d.length===t.length&&finite(d)&&finite(t))add(`总距离${sum(d)}米；已知工作时间${duration(sum(t))}，不含休息`)}
 // Explicit repeated distance + only the reported timings, including partial completion.
 const repeats=q.match(/(\d+)\s*[×x*]\s*(\d+(?:\.\d+)?)米/),timings=q.match(/(?:前\d+组(?:是|为)|成绩(?:依次)?(?:是|为))([\d.、,，和秒\s]+)秒/);
 if(repeats&&timings){let ts=numberList(timings[1]);const last=q.match(/第\d+组(?:做了|用时|是|为)(\d+(?:\.\d+)?)秒/);if(last)ts.push(+last[1]);if(finite(ts)&&ts.length<=+repeats[1])add(`已知完成${ts.length*+repeats[2]}米；已知工作时间${duration(sum(ts))}；${ts.length<+repeats[1]?'其余组完成状态未知，不按零或完成处理':'所述各组均有时间记录'}`)}
 // Equal-distance repetitions and an explicitly indexed correction preserve old total.
 const series=(s:string)=>s.match(/(?:成绩(?:依次)?(?:是|为)|成绩依次为)([\d.、,，和秒\s]+)秒/);
 const own=series(q);
 if(!repeats&&own){const ts=numberList(own[1]);if(finite(ts))add(`所述各组工作时间合计${duration(sum(ts))}；首组${ts[0]}秒，末组${ts.at(-1)}秒；时间${ts.at(-1)!>ts[0]?'增加':ts.at(-1)!<ts[0]?'减少':'相同'}，不能据此证明原因`)}
 const correction=q.match(/第(\d+)组(?:实际)?(?:是|为)(\d+(?:\.\d+)?)秒/);
 if(correction&&/更正|记错|更新|其他.*不变/.test(q)){
  const before=[...prior].reverse().find(s=>series(s.normalize('NFKC')));
  if(before){const m=series(before.normalize('NFKC'))!,ts=numberList(m[1]),i=+correction[1]-1;if(finite(ts)&&i>=0&&i<ts.length){const old=sum(ts),oldValue=ts[i];ts[i]=+correction[2];add(`旧总时间${old}秒；更正第${i+1}组由${oldValue}秒为${ts[i]}秒，新总时间${sum(ts)}秒；其余组不变，旧自述保留，未改写已保存记录`)}}
 }
 const minutes=q.match(/(?:训练总时长|总时长|整课时长)\s*(\d+(?:\.\d+)?)分钟/),rpe=q.match(/整课\s*RPE(?:为|是)?\s*(\d+(?:\.\d+)?)/i);
 if(minutes&&rpe&&/(?:0\s*[–—-]\s*10|0到10|0至10)/.test(q)&&+rpe[1]<=10&&!/整课.*(?:未知|没填|未填)/.test(q))add(`整课主观负荷${+minutes[1]}分钟×${+rpe[1]}=${+minutes[1]*+rpe[1]} AU；仅为主观负荷，不能表示疲劳百分比`);
 // Keep planned and completed strength sets separate and keep per-hand load basis.
 const hand=q.match(/每手\s*(\d+(?:\.\d+)?)\s*(?:公斤|千克)/),reps=q.match(/每组\s*(\d+)次/),sets=q.match(/实际完成\s*(\d+)组/);
 if(hand&&reps&&sets)add(`实际完成${+sets[1]}组、${+sets[1]*+reps[1]}次；每只手负重次数积${+hand[1]*+sets[1]*+reps[1]} kg·次；跳过的组不计入完成`);
 // Directly paired distances/durations, arbitrary distances and order.
 const pace=[...q.matchAll(/(?:(甲|乙|昨天|今天|前天))?跑\s*(\d+(?:\.\d+)?)公里(?:用时)?\s*(\d+(?:\.\d+)?)分钟/g)].filter(m=>+m[2]>0);
 if(pace.length>=2){const ps=pace.map(m=>Number((+m[3]*60/+m[2]).toFixed(6)));add(pace.map((m,i)=>`${m[1]??'第'+(i+1)+'次'}平均配速${Math.floor(ps[i]/60)}:${String(Math.round(ps[i]%60)).padStart(2,'0')}/km`).join('；')+`；${pace[ps.indexOf(Math.min(...ps))][1]??'第'+(ps.indexOf(Math.min(...ps))+1)+'次'}用时每公里较少、更快；条件未必相同，不证明疲劳因果`)}
 const year=q.match(/(?:只求|求|计算|统计|汇总)\s*(20\d{2})年/),dated=[...q.matchAll(/(20\d{2})-\d{2}-\d{2}跑\s*(\d+(?:\.\d+)?)公里/g)];
 if(year&&dated.length){const ds=dated.filter(m=>m[1]===year[1]);add(`${year[1]}年已记录${sum(ds.map(m=>+m[2]))}公里；计入${ds.length}条所述记录，不能证明全年实际训练全部记录齐全`)}
 const calories=[...q.matchAll(/记录了\s*(\d+(?:\.\d+)?)千卡/g)].map(m=>+m[1]);
 if(calories.length)add(`已记录摄入${sum(calories)}千卡；${/还没记录|未记录|没记录/.test(q)?'全天完整性未知，不将未记录餐次补零':'按用户明确提供的餐次声明核对全天覆盖，不替代独立验证'}`);
 return out.slice(0,8).map((detail,i)=>({id:`question:calculation:${i}`,kind:'FACT',detail}));
}
