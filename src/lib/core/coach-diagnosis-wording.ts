/** Local output validator: referrals are allowed once, after the opening sentence. */
export const DIAGNOSIS_TERMS = [
 '心肌缺血','心肌梗死','心梗','心绞痛','冠心病','心肌炎','心包炎','心力衰竭','心衰','房颤','房扑','室颤','室速','心动过速','心动过缓','心律失常','高血压病','主动脉夹层','肺栓塞','深静脉血栓',
 '热射病','中暑','热衰竭','热痉挛','横纹肌溶解','横纹肌溶解症','低钠血症','高钠血症','低钾血症','高钾血症','低血糖','糖尿病','甲亢','甲减','甲状腺功能亢进','甲状腺功能减退','肾上腺功能不全','库欣综合征',
 '脑卒中','脑梗','脑梗死','脑出血','中风','短暂性脑缺血发作','癫痫','脑震荡','脑膜炎','偏头痛','格林巴利综合征','马尾综合征','坐骨神经痛','神经根病','周围神经病','椎间盘突出','腰椎间盘突出','颈椎病','脊髓损伤',
 '应力性骨折','疲劳性骨折','骨折','骨裂','骨质疏松','骨膜炎','髌腱炎','跟腱炎','跟腱断裂','足底筋膜炎','髂胫束综合征','髌股疼痛综合征','半月板损伤','韧带撕裂','韧带断裂','肌肉拉伤','肌腱炎','滑囊炎','关节炎','骨关节炎','类风湿','筋膜室综合征',
 '贫血','缺铁性贫血','缺铁','闭经综合征','多囊卵巢综合征','功能性下丘脑性闭经','性腺功能减退','RED-S','REDs','相对能量缺乏综合征','过度训练综合征','运动性哮喘','哮喘','肺炎','支气管炎','气胸','慢阻肺','呼吸衰竭','肾衰竭','肾功能衰竭','尿毒症',
 '抑郁症','焦虑症','惊恐障碍','惊恐发作','双相障碍','躁郁症','强迫症','神经性厌食','厌食症','贪食症','进食障碍','躯体化障碍','创伤后应激障碍','失眠症'
] as const
export type DiagnosisIssue={sentence:string;terms:string[];reason:'DIAGNOSTIC_EXPLANATION'|'FIRST_SENTENCE_DIAGNOSIS'|'REPEATED_REFERRAL'}
function sentences(text:string):string[]{return text.split(/(?<=[。！？!?；;])|\n/).map(s=>s.trim()).filter(Boolean)}
function termsIn(s:string):string[]{const found=DIAGNOSIS_TERMS.filter(t=>s.toLowerCase().includes(t.toLowerCase()));return [...new Set(found.filter(t=>!found.some(other=>other!==t&&other.includes(t))))]}
export function diagnosisWordingIssues(text:string):DiagnosisIssue[]{
 let referrals=0;const issues:DiagnosisIssue[]=[]
 for(const [i,s] of sentences(text).entries()){
  const terms=termsIn(s);if(!terms.length)continue
  const attributed=/按你提供的(?:医生|医疗)|你提到医生(?:已)?诊断|据你转述的医生诊断/.test(s)
  const referral=/医生.{0,12}(?:排除|评估|检查)|专业.{0,8}排除|这不是诊断/.test(s)
  const conclusion=/可能是|极可能|说明你|符合|提示|诊断为|解释\s*[一二12]|你(?:得了|患有|属于)|就是.{0,16}(?:引起|造成)|(?:判断|确定|肯定)是/.test(s)
  if(attributed&&!conclusion)continue // Explicit attribution is not a new diagnosis.
  if(!referral||conclusion)issues.push({sentence:s,terms,reason:'DIAGNOSTIC_EXPLANATION'})
  else {referrals+=terms.length;if(i===0)issues.push({sentence:s,terms,reason:'FIRST_SENTENCE_DIAGNOSIS'});else if(referrals>1)issues.push({sentence:s,terms,reason:'REPEATED_REFERRAL'})}
 }
 return issues
}
export function filterDiagnosisWording(text:string):{text:string;issues:DiagnosisIssue[]}{
 const issues=diagnosisWordingIssues(text);if(!issues.length)return {text,issues}
 const invalid=new Set(issues.map(x=>x.sentence));let inserted=false
 return {text:sentences(text).map(s=>{if(!invalid.has(s))return s;if(inserted)return '';inserted=true;return '症状需要专业评估，不能在聊天中判断原因。'}).filter(Boolean).join('\n'),issues}
}
export const DIAGNOSIS_SYSTEM_BOUNDARY='不能把诊断名作为结论、竞争解释或主要推测。负例：解释一，你可能是髌腱炎。正例：训练反应与动作负荷可能有关，但症状原因需要专业评估。仅在开头之后允许一次医生排除某种疾病的转介，不输出鉴别诊断清单。复述用户的医生诊断必须写明“按你提供的医生诊断”，不得重新确诊。'
