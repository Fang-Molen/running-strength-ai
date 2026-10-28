/** Independently written, ConText-inspired bounded Chinese scope; no external code/data. */
export type Temporal = 'CURRENT'|'HISTORY'|'HYPOTHETICAL'|'KNOWLEDGE'
export const historicalCue=/去年|前年|上个月|上周|以前|曾经|(?<!晕|昏)过去|之前那次|小时候|\d+年前|\d+个月前/
const knowledgeCue=/科普|什么是|请解释|讲解|定义|知识|论文|如何预防|只是咨询|想了解/
const hypotheticalCue=/假如|假设|设想|例如|举例|如果|万一/
const currentCue=/现在|目前|刚刚|刚才|今天|此刻|这会|正在|刚跑|刚练|刚结束/
const currentResetCue=/现在|目前|刚刚|刚才|此刻|这会|刚跑|刚练|刚结束/
const reportedCurrentCue=/现在|目前|此刻|这会|跑步时|运动中|运动后|跑完|练完|刚跑|刚练|刚结束|训练后/
export type TemporalClause={text:string;temporal:Temporal}
/** Also recognize unpunctuated transitions, while keeping "如果现在……" hypothetical. */
function temporalParts(clause:string):string[]{
 const parts:string[]=[]
 let rest=clause
 while(rest){
  const cue=[knowledgeCue,hypotheticalCue,historicalCue].map(re=>({re,index:rest.search(re)})).filter(item=>item.index>=0).sort((a,b)=>a.index-b.index)[0]
  let boundary=-1
  if(cue){
   const before=rest.slice(0,cue.index)
   if(cue.index>0&&reportedCurrentCue.test(before)&&!/阅读|读了|看到|看了|资料|学习|听说|听到|讨论|研究/.test(before))boundary=cue.index
   else if(cue.re===historicalCue){
    const match=currentResetCue.exec(rest.slice(cue.index))
    if(match)boundary=cue.index+match.index
   }
  }
  if(boundary<=0){parts.push(rest);break}
  parts.push(rest.slice(0,boundary));rest=rest.slice(boundary)
 }
 return parts
}
/** A context cue applies forward, never to an already reported preceding clause. */
export function temporalContextClauses(text:string):TemporalClause[]{
 let temporal:Temporal='CURRENT'
 return contextClauses(text).flatMap(temporalParts).map(clause=>{
  // A time word inside an explicit hypothetical/knowledge clause is still hypothetical.
  if(knowledgeCue.test(clause))temporal='KNOWLEDGE'
  else if(hypotheticalCue.test(clause))temporal='HYPOTHETICAL'
  else if(historicalCue.test(clause))temporal='HISTORY'
  else if(currentCue.test(clause))temporal='CURRENT'
  // Without a new cue, later symptoms retain the initial hypothetical/history scope.
  return {text:clause,temporal}
 })
}
export function textTemporal(text:string):Temporal {
 const clauses=temporalContextClauses(text)
 // CURRENT means the text contains an actual/current part, not that every part is current.
 return clauses.some(clause=>clause.temporal==='CURRENT')?'CURRENT':clauses[0]?.temporal??'CURRENT'
}
export function contextClauses(text:string):string[]{return text.split(/[，,。；;！!？?\n]|但是|(?<!喘|透)不过|可是|然而|(?<!不)但(?!是)/).filter(Boolean)}
/** Questions, unconfirmed fields and prospective stop rules do not report an existing symptom. */
export function unassertedAt(clause:string,index:number,length:number):Temporal|null {
 const before=clause.slice(0,index),after=clause.slice(index+length)
 // Question scope spans an enumerated symptom list, not only the word adjacent to “是否”.
 if(/(?:是否|有无|有没有|请问|想问|想确认)[^。；!?！？]{0,100}$/.test(before)&&!/(?:但是|然而|其实|实际)(?:我|他|她|现在)/.test(before))return 'KNOWLEDGE'
 if(/(?:确认|核对|排除)[^。；]{0,80}$/.test(before)&&/(?:之前|以前|前|后|以后)/.test(after))return 'HYPOTHETICAL'
 // Keep an actual first/third-person assertion even when its severity still needs checking.
 const actual=/(?:我|本人|你|他|她|队友|学员|孩子|女儿|儿子|妹妹|姐姐|哥哥|弟弟)(?:现在|目前|刚刚|刚才|今天|正在)?(?:已经|仍然|还是|有|出现|感觉|感到|觉得){0,3}$/.test(before)
 if(actual)return null
 if(/(?:停止|终止)条件[:：]/.test(before))return 'HYPOTHETICAL'
 if(/^(?:加重|出现|发生|持续)?时(?:应|要|请|就|需)?(?:立即)?(?:停止|暂停|就医|求助|联系)/.test(after)&&!/(?:停止|暂停)了/.test(after))return 'HYPOTHETICAL'
 if(/(?:出现|发生|遇到)(?:明显|局部|持续|严重)?$/.test(before)&&/(?:就|则|应当|应立即)(?:停止|暂停|就医|求助)/.test(after))return 'HYPOTHETICAL'
 if(/^(?:的)?(?:情况|变化|程度|评分|记录|状态)?(?:尚|还|仍)?(?:需|待|有待)(?:进一步)?(?:核对|确认|核实)|^(?:情况|变化|程度|评分|记录|状态)(?:未知|未记录|不明确|不确定|尚不清楚)/.test(after))return 'KNOWLEDGE'
 return null
}
export function negatedAt(clause:string,index:number,length:number):boolean {
 const before=clause.slice(0,index),after=clause.slice(index+length)
 // Pseudo-negations are not negation triggers. A later actual "没有" still applies.
 const scope=before.replace(/非常|未来|不一定|不得不|没事儿/g,'')
 // v86: a pain score of 0 negates the pain mention ("疼痛0", "走路疼痛0/10", "疼痛评分0分"); 1–10 stays a real report.
 return (/(?:痛|疼)$/.test(clause.slice(index,index+length))&&/^(?:程度|评分|分数|强度)?\s*(?:为|是)?[:：]?\s*0(?:\.0+)?(?:\s*\/\s*10|分|级)?(?![\d./])/.test(after))
  // v86: one negator covers an enumerated symptom list, with or without separators ("无胸痛晕厥发热", "没有晕厥胸痛或急性骨痛").
  || /(?:没有|并无|并没有|否认|从没|不曾|未曾|未|没|无|不)(?:任何|明显|严重|特别|持续|反复|运动后|病后|出现|发生|过|有|觉得|感到|感觉){0,3}(?:[、和及或也不]*(?:胸痛|胸闷|胸口压迫|气短|气促|心悸|头晕|疼痛|发热|发烧|麻木|晕厥|昏厥|晕倒|冷汗|意识不清|呼吸困难|口齿不清|单侧无力|喉咙发紧|嘴唇肿胀|急性骨痛|骨痛|畸形|急症))*[、和及或也]*(?:急性|明显)?$/.test(scope)
  || /^(?:不存在|已排除|没有发生|并没有)/.test(after)
}

/** Generated prose is not a second patient message. Only explicit present-state assertions can escalate. */
export function generatedCurrentAssertions(text:string):string {
 text=text.normalize('NFKC').replace(/[^\S\n]+/g,'')
 const asserted:string[]=[]
 for(const {text:clause,temporal} of temporalContextClauses(text)){
  if(temporal!=='CURRENT')continue
  if(/是否|有无|有没有|请问|请确认|请核对|确认.{0,60}(?:前|后)|(?:若|如果|一旦|万一|假如|假设)/.test(clause)||/(?:吗|么|呢)$/.test(clause))continue
  if(/(?:你|您|他|她|当事人|同伴|队友|用户|运动员)(?:现在|目前|此刻|刚才|已经|仍然|正在|还|有|出现|存在|表现为|感到|感觉|持续|的症状是|的情况是|的当前症状是)/.test(clause)||
     /^(?:现在|目前|当前|此刻)(?:的)?(?:症状|状态|表现|情况)?[:：]?/.test(clause)||/^(?:已出现|现有|现存|同时伴有|伴有)/.test(clause)||
     /(?:评估|检查|记录)(?:已经)?(?:显示|发现|表明)(?:你|其|当事人)?(?:现在|目前|已有|出现|存在)/.test(clause))asserted.push(clause)
 }
 return asserted.join('。')
}
