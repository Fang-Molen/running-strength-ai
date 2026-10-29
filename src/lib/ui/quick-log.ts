/** One confirmed first-person fact. Ambiguous dates, multiple facts and other people remain notes. */
export type Parsed = (
  | { kind: "run"; title: string; km: number | null; minutes: number | null; pace: string | null; when: "am" | "pm" | null }
  | { kind: "strength"; name: string; sets: number; reps: number; kg: number | null; weightBasis?: '单手' | '单侧' | '总重' | '自重' }
  | { kind: "weight"; kg: number }
  | { kind: "unknown"; text: string }
) & {date?:string;unrecorded?:string[]}
const CN: Record<string, number> = { 一:1, 两:2, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 }
const localDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&localDate(new Date(`${s}T12:00:00`))===s
export function parseQuickLog(input: string, referenceDay=localDate(new Date())): Parsed {
  const original=input.trim().replace(/\s+/g,' '),unknown:Parsed={kind:'unknown',text:original}
  let t=original,date:string|undefined
  if(!validDate(referenceDay)||/朋友|队友|他人|别人|家人|教练说|(?:他|她)(?:今天|昨天|跑|做|体重|深蹲|卧推)|没有|没(?:有|跑|做|练)|未(?:跑|做|练)|不(?:是|跑|做|练)|计划|打算|准备|如果|假设|目标|明天|后天/.test(t))return unknown
  if(/[；;\n]/.test(input)||/(?:早餐|午餐|晚餐|加餐)/.test(t))return unknown
  const explicit=t.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/)
  const short=!explicit?t.match(/(?:(去年|今年)\s*)?(\d{1,2})月(\d{1,2})日?/):null
  const relative=t.match(/前天|昨天|今天/)
  if(explicit){date=`${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`;t=t.replace(explicit[0],'')}
  else if(short){date=`${Number(referenceDay.slice(0,4))-(short[1]==='去年'?1:0)}-${short[2].padStart(2,'0')}-${short[3].padStart(2,'0')}`;t=t.replace(short[0],'')}
  else if(relative){const d=new Date(`${referenceDay}T12:00:00`);d.setDate(d.getDate()-(relative[0]==='前天'?2:relative[0]==='昨天'?1:0));date=localDate(d);t=t.replace(relative[0],'')}
  if(date&&(!validDate(date)||date>referenceDay))return unknown
  if(/去年|上周|上月|前几天|\d{1,2}[月/-]\d{1,2}/.test(t))return unknown
  const day=date?{date}:{}
  t=t.trim().replace(/^我\s*/,'').trim()
  const when=/早|上午|晨/.test(t)?'am':/晚|下班|夜/.test(t)?'pm':null
  const weight=t.match(/^(?:体重\s*)?(\d+(?:\.\d+)?)\s*(?:kg|公斤)$/i)??t.match(/^体重\s*(\d+(?:\.\d+)?)$/)
  if(weight&&Number(weight[1])>=30&&Number(weight[1])<=250)return {kind:'weight',kg:Number(weight[1]),...day}
  const setMatch=t.match(/([一两二三四五六七八九十\d]+)\s*[×xX*组]\s*(\d+)\s*次?/)
  if(setMatch&&!/跑|公里|km/i.test(t)){
    const sets=CN[setMatch[1]]??Number(setMatch[1]),reps=Number(setMatch[2])
    const rest=t.replace(setMatch[0],'').trim(),weights=[...rest.matchAll(/(\d+(?:\.\d+)?)\s*(kg|公斤|磅|斤|lb\b)/gi)]
    if(weights.length>1||weights.some(w=>!/^(kg|公斤)$/i.test(w[2]))||sets<1||sets>20||reps<1||reps>100)return unknown
    const basis=rest.match(/单手|每手|单侧|每侧|总重|自重/)?.[0]
    const weightBasis=basis==='每手'?'单手':basis==='每侧'?'单侧':basis as '单手'|'单侧'|'总重'|'自重'|undefined
    const kg=weights[0]?Number(weights[0][1]):null
    const name=rest.replace(weights[0]?.[0]??'','').replace(/单手|每手|单侧|每侧|总重|自重/g,'').trim()
    if(!name||/\d|[，,、]/.test(name)||kg!==null&&(kg<=0||kg>1000)||weightBasis==='自重'&&kg!==null)return unknown
    return {kind:'strength',name,sets,reps,kg,...(weightBasis?{weightBasis}:{}),...day}
  }
  if(/跑|公里|km/i.test(t)){
    if(/力量|深蹲|卧推|硬拉|引体|俯卧撑|哑铃|杠铃|弓步|推举|划船|卷腹/.test(t))return {...unknown,...day,unrecorded:['跑步与力量混合，快速记录无法完整拆分；仅保存原文笔记，请到详细记录逐项核对。']}
    const unrecorded=[...(/心率|\bHR\b/i.test(t)?['心率仅保留在原文，尚未记入结构化训练']:[]),...(/步频|功率|海拔/.test(t)?['步频、功率或海拔仅保留在原文']:[]),...(/组|[×xX*]/.test(t)?['分段/间歇组结构尚未核对，快速记录仅保存已识别的总量']:[])]
    const distances=[...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:公里|km|k\b)/gi)];if(distances.length>1)return unknown
    const paceToken=t.match(/(?:配速|均速)\s*(\d{1,2})(?:[:'：]|分(?:钟)?)\s*(\d{1,2})(?:秒)?/)
    if(paceToken&&Number(paceToken[2])>=60)return unknown
    const durationText=t.replace(/(?:配速|均速)\s*\d+(?:\.\d+)?\s*(?:[:'：]\s*\d{1,2}|分(?:钟)?(?:\s*\d{1,2}\s*秒?)?|min(?:\s*\d{1,2}\s*s)?)/gi,'')
    const times=[...durationText.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:分钟|min\b|分)(?:\s*(\d{1,2})\s*秒)?/gi)]
    if(times.length>1||times[0]?.[2]&&Number(times[0][2])>=60)return unknown
    const seconds=durationText.match(/(?<![\d.])(\d+(?:\.\d+)?)\s*秒/)
    const minutes=times[0]?Number(times[0][1])+Number(times[0][2]??0)/60:seconds?Number(seconds[1])/60:null
    const km=distances[0]&&Number(distances[0][1])>0?Number(distances[0][1]):null
    const pace=paceToken?`${Number(paceToken[1])}:${paceToken[2].padStart(2,'0')}`:km&&minutes?(()=>{const s=Math.round(minutes*60/km);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`})():null
    const title=(t.match(/轻松跑|慢跑|节奏跑|间歇跑?|长距离|长跑|跑步|跑/)?.[0]??'跑步').replace(/^跑$/,'跑步')
    return {kind:'run',title,km,minutes:minutes&&minutes>0?minutes:null,pace,when,...day,...(unrecorded.length?{unrecorded}:{})}
  }
  return unknown
}
