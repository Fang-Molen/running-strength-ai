/** Candidate lexical screening only. No diagnosis/clearance; G0 professional review remains pending. */
export type LocalSafety = 'EMERGENCY' | 'MEDICAL_REVIEW' | 'NONE'
const EMERGENCY = /胸痛|胸口痛|胸闷|晕厥|晕倒|晕过去|昏厥|失去意识|呼吸困难|喘不过气|吐血|呕血|黑便|便血|酱油色尿|茶色尿|红色尿|尿色像可乐|可乐色尿|尿液呈可乐色|严重头晕|突然意识模糊|伤害自己|自杀|自残|不想活(?:了)?|想死|结束生命/g
const REVIEW = /贫血|铁蛋白|血红蛋白|缺铁|补铁剂|月经紊乱|经期紊乱|闭经|反复骨折|应力性骨折|长期低能量|red-s|reds|持续疲劳|头晕|厌食|催吐|暴食|极端少吃|每天只吃\d+|每天(?:只)?吃\s*[1-6]\d\d\s*(?:千卡|卡)|每天.*1rm|腘绳肌.*伤|膝盖.*痛|大腿后侧.*(?:酸痛|紧绷)|疼痛[1-9]\/10|发烧|带伤/g
const NEGATIVE = /(?:没有|并无|否认|不曾|不想|不是|无|并没有|已经没有|并非|排除)(?:任何|出现|发生|患有|得了|被诊断为|过|有|要|了)?$/
const PAST = /去年|上个月|以前|曾经|之前|过去|小时候|两年前|上周/
const ACTIVE = /现在(?:还|仍|又|有|正在)|目前(?:还|仍|有)|刚刚|刚才|此刻|今天(?:出现|发生|又)|又出现|再次|仍然|持续/
export function screenLocalSafety(question:string):{level:LocalSafety;signals:string[];historical:string[];psychological:boolean} {
  const q=question.toLowerCase().replace(/\s+/g,'')
  const clauses=q.split(/[，,。；;！!？?\n]|但是|但现在|(?<!喘)不过|然而/).filter(Boolean)
  const active:string[]=[],historical:string[]=[],review:string[]=[]
  let psychological=false
  for(const clause of clauses) {
    for(const m of clause.matchAll(EMERGENCY)) {
      const start=m.index??0,before=clause.slice(0,start),after=clause.slice(start+m[0].length)
      if(NEGATIVE.test(before)) continue
      if(/^(?:的)?(?:念头|想法).{0,4}(?:已经没有|现在没有|目前没有)|^(?:已排除|已经排除|已经好了|已经恢复正常|不存在)/.test(after)) {historical.push(m[0]);continue}
      const psych=/伤害自己|自杀|自残|不想活|想死|结束生命/.test(m[0])
      if(psych) psychological=true
      if(PAST.test(before) && !ACTIVE.test(before.replace(PAST,''))) {historical.push(m[0]);continue}
      if(/想了解|科普|什么是|如何预防|只是咨询/.test(before) && !ACTIVE.test(before)) continue
      active.push(m[0])
    }
    for(const m of clause.matchAll(REVIEW)) {
      const before=clause.slice(0,m.index??0)
      if(!NEGATIVE.test(before)) review.push(m[0])
    }
  }
  return {level:active.length?'EMERGENCY':historical.length||review.length?'MEDICAL_REVIEW':'NONE',signals:[...active,...review],historical,psychological}
}
export function classifyLocalSafety(question:string):LocalSafety { return screenLocalSafety(question).level }
