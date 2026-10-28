import { temporalContextClauses, negatedAt, unassertedAt, textTemporal } from '../../safety/redflag/context.ts'
/** R11 deterministic symptom dimensions + scoped context. No model, diagnosis or storage writes. */
export type RedFlagLevel='EMERGENCY'|'URGENT_MEDICAL'|'MEDICAL_REVIEW'|'NONE'
export type RedFlagClass='HEAT'|'CARDIOVASCULAR'|'SYNCOPE'|'NEUROLOGICAL'|'RESPIRATORY'|'ENERGY'|'YOUTH'|'POST_ILLNESS'|'PAIN'|'PSYCHOLOGICAL'|'OTHER'|'ALLERGY'|'CARDIAC_ARREST'
export type RedFlagSubject='SELF'|'OTHER'|'UNKNOWN'
export type RedFlagTemporal='CURRENT'|'HISTORY'|'HYPOTHETICAL'|'KNOWLEDGE'
export type RedFlagScene='TRAINING'|'HOME_AFTER'|'UNKNOWN'
export type RedFlagResult={scene?:RedFlagScene;level:RedFlagLevel;classes:RedFlagClass[];subject:RedFlagSubject;negated:boolean;temporal:RedFlagTemporal;evidence:string[]}
export type RedFlagContext={ageYears?:number;subject?:RedFlagSubject;exerciseRelated?:boolean;prior?:RedFlagResult;excludeOtherSubjects?:boolean}
export const RED_FLAG_PRIORITY:Record<RedFlagLevel,number>={NONE:0,MEDICAL_REVIEW:1,URGENT_MEDICAL:2,EMERGENCY:3}
export function chineseNumber(text:string):number|null{
 const raw=text.replace(/两/g,'二');if(/^\d+(?:\.\d+)?$/.test(raw))return Number(raw)
 const chars:Record<string,number>={零:0,〇:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9}
 if(raw==='半')return .5
 let total=0,current=0;for(const c of raw){if(c in chars)current=chars[c];else if(c==='十'||c==='百'||c==='千'){total+=(current||1)*({十:10,百:100,千:1000}[c]);current=0}else return null}return total+current
}
export function normalizeCoachText(input:string):string{
 return input.normalize('NFKC').toLowerCase().replace(/\s+/g,'').replace(/攝氏|摄氏/g,'').replace(/心荒/g,'心慌').replace(/胸门/g,'胸闷').replace(/晕到/g,'晕倒').replace(/说化/g,'说话').replace(/麻木木/g,'麻木').replace(/未成粘/g,'未成年')
  .replace(/[一二两三四五六七八九十百千零〇]+(?:点[一二三四五六七八九零〇]+)?(?=几?度|℃|岁|大卡|千卡|卡路里|kcal|分钟|小时)/g,m=>String(chineseNumber(m)??m))
}
export function ageFromText(text:string):number|null{
 const q=normalizeCoachText(text),m=q.match(/(?<!\d)(\d{1,2})岁/);if(m)return Number(m[1])
 return /小学|初中|初一|初二|初三|高一|高二|中学生|未成年/.test(q)?15:null
}
export function temperatureFromText(text:string):number|null{
 const q=normalizeCoachText(text);const values=[...q.matchAll(/(?<!\d)(\d{2}(?:\.\d+)?)(?:几)?(?:度|℃|°c)/g)].filter(m=>!/体温|发烧|烧到|烧了/.test(q.slice(Math.max(0,m.index!-8),m.index)))
 return values.length?Math.max(...values.map(m=>Number(m[1]))):null
}
export function energyIntakeFromText(text:string):number|null{
 const m=normalizeCoachText(text).match(/(?<!\d)(\d{3,4})(?:大卡|千卡|卡路里|kcal|卡)/);return m?Number(m[1]):null
}
export function heartRateFromText(text:string):number|null{
 const m=normalizeCoachText(text).match(/(?:心率|脉搏|脉率|心跳)(?:是|为|到了|达到|每分|每分钟|:|：)?(\d{2,3})(?:次|bpm)?/);return m?Number(m[1]):null
}
export function symptomDurationMinutes(text:string):number|null{
 const m=normalizeCoachText(text).match(/(?:持续|已经|休息|歇了|静坐)(\d+(?:\.\d+)?)(分钟|小时)/);return m?Number(m[1])*(m[2]==='小时'?60:1):null
}
// Each dimension owns synonyms/morphology, independent of person, activity or complete sentences.
export const SYMPTOM_DIMENSIONS={
 heat:/高温|炎热|酷热|热浪|热天|大热天|闷热|闷得慌|桑拿天|三伏|伏天|暑天|酷暑|夏至|大暑|小暑|暴晒|曝晒|烈日|太阳底下|大太阳|日头底下|正午|夏季午间|夏天中午|没热适应|没有热适应|未热适应/g,
 mental:/意识(?:不清|模糊|混乱)|神[志智](?:不清|模糊|异常)|迷糊|迷迷糊糊|糊涂|发懵|犯懵|懵了|蒙了|脑子(?:不清楚|不清醒|乱|发木)|反应(?:迟钝|很慢|不对)|答非所问|问非所答|不认人|认不出人|叫不醒|喊不醒|叫.{0,3}没反应|喊.{0,3}不(?:答|应)|不搭理人|不应答|没应答|不回应|胡言乱语|乱讲话|行为(?:反常|异常)|举止(?:反常|异常)|走路乱晃/g,
 speech:/舌头(?:打结|不听使唤)|说话(?:突然)?(?:含混|含糊)|言语(?:不清|含糊|异常)|语言(?:不清|含糊)|说话不(?:太)?(?:清楚|清晰|利索)|说不清话|话说不清|吐字(?:含糊|不清)|口齿(?:含糊|不清)|嘴里嘟囔|讲话(?:含糊|含混|不清)|说话大舌头|口角歪|嘴歪|嘴角歪/g,
 dry:/无汗|不出汗|没出汗|没有汗|不流汗|汗(?:突然)?停了|汗出不来|汗都没了|皮肤(?:干热|干烫|滚烫|又干又热)|身上(?:干烫|滚烫)|烫手|干巴巴.*热/g,
 chills:/寒战|寒颤|打寒战|打寒颤|打冷颤|打哆嗦|冻得抖|鸡皮疙瘩/g,
 seizure:/抽搐|抽风|全身抽动|四肢抽动/g,
 chest:/胸痛|胸口痛|胸闷|胸口(?:发|很|有点|一阵阵?|阵阵|反复|突然|像)?(?:紧|闷|憋|压|疼|痛)|胸部.{0,5}(?:紧|闷|压|疼|痛)|前胸.{0,4}(?:疼|压|闷)|心口.{0,5}(?:疼|痛|堵|紧)|胸前像压.{0,5}|胸口不舒服/g,
 palpitation:/心悸|心慌|心跳(?:一直|持续|反复)?(?:乱|不齐|不规则|漏|停一拍|忽快忽慢|特别快|很快)|心脏(?:乱跳|扑通|狂跳|漏跳)|心砰砰|心突突|心扑腾|心里扑通|心律不齐/g,
 radiating:/上肢.{0,7}(?:麻|痛|疼|酸|放射)|(?:胳膊|手臂|左臂|右臂|脖子|颈部|下巴|下颌|肩膀).{0,7}(?:麻|痛|疼|酸)|放射到.{0,8}(?:臂|颈|颌|肩)/g,
 sweat:/冷汗|冒汗|满头汗|大汗|浑身汗|汗淋淋/g,
 syncope:/晕厥|晕倒|晕过去|昏厥|昏倒|昏过去|失去意识|意识丧失|不省人事|断片|差点(?:晕|昏|倒)|险些(?:晕|倒)|快要(?:晕|昏|倒)|快晕|要晕了|要昏了|欲晕|想晕|像要(?:晕|昏)|快(?:晕|昏)过去|快倒了|要倒了|眼前(?:一片)?(?:发黑|发白|黑了|白了|一黑|一白)|视物(?:发黑|发白)|黑蒙|黑矇|站不住|天旋地转|严重头晕/g,
 breath:/气短|气不够|喘不上|喘不过|透不过气|呼吸困难|呼吸费力|喘气费劲|喘得厉害|喘得说不了|呼吸急促|呼吸不上/g,
 severeBreath:/喘不过气|喘不上气|透不过气|呼吸困难|严重气促|严重气短|明显气短|说话不成句|说不成句|口唇发绀|嘴唇(?:发紫|青紫|发蓝)|说不出(?:完整|一句|整句)|一句话.{0,6}(?:说不完|说不出)|说句话.{0,4}(?:断|喘)/g,
 back:/腰.{0,5}(?:过电|放电|触电|电击)|腰痛|腰疼|背痛|背疼|腰背.{0,4}(?:痛|疼)|后背.{0,4}(?:痛|疼)|腰.{0,4}(?:闪了|扭了|痛|疼)|脊柱.{0,5}(?:痛|疼)/g,
 legNerve:/(?:下肢|双腿|左腿|右腿|腿|脚|足).{0,7}(?:麻木|发麻|麻|无力|没劲|使不上力|使不上劲|放电|过电|电击|拖着)|(?:麻木|放电|电击).{0,5}(?:腿|脚|下肢)/g,
 bladder:/(?:控制不住|憋不住|管不住)(?:排尿|排便|大小便|尿|便)|(?:排尿|排便|大小便|小便|大便|尿便).{0,6}(?:失控|失禁|控制不住|憋不住)|大小便.{0,5}(?:异常|失控|失禁|困难)|小便.{0,5}(?:尿不出|失禁|失控)|尿不出来|尿不出|尿潴留|尿失禁|便失禁|大便失控|会阴.{0,5}(?:麻|没感觉|异常)|裆部.{0,5}(?:麻|没感觉)|鞍区.{0,5}麻/g,
 unilateral:/(?:左|右)(?:手|胳膊|手臂|腿|脚).{0,5}(?:无力|抬不起来|使不上劲|使不上力|没力气|没劲|拿不住|握不住)|(?:一只|一边的?)(?:手|腿).{0,5}(?:无力|拿不住|使不上劲)|(?:半边|一侧)(?:脸|面部).{0,5}(?:麻|没感觉|下垂)|(?:单侧|一侧|半边|左半边|右半边).{0,7}(?:无力|瘫|动不了|没力)|一边胳膊.{0,4}(?:抬不|无力)|突发剧烈头痛/g,
 illness:/发烧|发热|退烧|退热|感冒|流感|感染|新冠|转阴|阳过|病后|病刚好|生病|咽痛|咳嗽|鼻塞/g,
 energy:/闭经|停经|月经(?:紊乱|不调|推迟|停了|不来|没来|变少)|经期紊乱|没来月经|不来月经|姨妈(?:不来|没来|停了|不来了)|大姨妈.{0,4}(?:没来|不来)|例假.{0,4}(?:没来|不来|停了)|反复骨折|骨应力|应力性骨折|低能量|red-s|reds|极端少吃|节食|极端(?:控体重|控制体重|减重)|不吃晚饭|不吃主食|长期少吃|每天只吃|一天只吃|只吃[一二两三\d]顿|压低摄入|食量压低|卡热量|催吐|厌食|晨勃(?:减少|没了|消失)|没有晨勃|性欲(?:下降|低下)|激素偏低/g,
 // Keep the body part in each match so existing negation/temporal scoping
 // applies to “没有腿疼”; do not absorb 不/没 or convert ordinary 酸痛.
 pain:/疼痛|刺痛|锐痛|(?:大腿|小腿|腿|膝盖|膝关节|膝|脚踝|脚跟|脚底|足底|跟腱|肩膀|肩|手腕|胳膊|髋部)(?:内侧|外侧|前侧|后侧)?(?:有点|有些|一直|还是|仍然|正在|现在|越来越|特别|很|一阵阵?|隐隐)?(?:疼|痛)|骨头.{0,8}痛|膝盖.{0,7}痛|跟腱.{0,5}疼|小腿.{0,5}痛|腘绳肌.{0,5}伤|跛行|夜间痛|静息痛|关节卡住|局部肿胀|带伤|大腿后侧.{0,5}(?:酸痛|紧绷)/g,
 soreness:/(?:膝盖|小腿|大腿后侧|大腿|腿|跟腱|脚踝|踝|足底|脚|腰|背|肩|肘|手腕|髋|臀|胸|肌肉)?(?:有点|有些|正在|一直)?(?:酸痛|酸胀)/g,
 weightGoal:/控体重|控制体重|刻意减重/g,
 energyConcern:/恢复(?:一直|越来越|持续)(?:差|变差)|(?:天天|每天)(?:额外)?加练/g,
 arrest:/心(?:跳|脏)(?:突然|骤然|已经)?(?:骤停|停止|停了|不跳了)|(?:没|没有|无)(?:心跳|脉搏)|(?:叫不醒|喊不醒|没有反应|毫无反应).{0,8}(?:没呼吸|没有正常呼吸|不呼吸)/g,
 collapse:/倒(?:在)?地(?:上)?|倒下|躺在地上/g,
 unresponsive:/无反应|没反应|没有反应|毫无反应|叫不醒|喊不醒|叫不应|喊不应|(?:叫|喊|呼唤).{0,5}(?:不回应|不应|不醒)/g,
 noNormalBreath:/没有正常呼吸|没有呼吸|没呼吸|不呼吸|呼吸(?:很)?(?:异常|不正常)|喘息样呼吸|叹息样呼吸|濒死喘息|抽泣样呼吸|只剩抽泣|(?:只|偶尔).{0,4}(?:抽气|喘一下|喘息)|(?:像鱼|鱼一样).{0,4}(?:喘|张嘴)/g,
 allergyExposure:/过敏|风团|荨麻疹|全身.{0,5}(?:疹|痒)|蜂(?:蛰|蜇|叮)|虫(?:咬|叮)|叮咬|吃(?:了|完|过)|进食|花生|坚果|海鲜|虾|药后|服药后/g,
 systemicAllergy:/全身.{0,8}(?:过敏|风团|荨麻疹|疹|痒)|浑身.{0,6}(?:疹|痒)|荨麻疹|大片风团/g,
 throat:/喉(?:咙|头|部).{0,5}(?:紧|肿|堵)|嗓子(?:眼)?.{0,5}(?:堵|紧|肿)|咽喉.{0,4}(?:紧|肿|堵)/g,
 swelling:/(?:嘴唇|口唇|脸|面部|舌头|眼睑).{0,5}(?:肿|胀)/g,
 cyanosis:/(?:口唇|嘴唇|指甲|甲床|指尖).{0,5}(?:发紫|青紫|发蓝|紫了|变紫)|发绀/g,
 breathWorsening:/呼吸.{0,6}(?:越来越难|越来越困难|越来越费力|非常困难|极度困难)|越来越(?:喘|难喘)|快(?:喘|呼吸)不过来/g,
 vision:/复视|看(?:东西|物体).{0,5}(?:重影|双影)|一个(?:东西|物体)看成两个/g,
 grip:/拿不住(?:东西|杯子|筷子|手机)?|握不住|手里.{0,5}(?:掉|滑落)/g,
 vomiting:/呕吐|吐了|吐得|一直吐|反复吐/g,
 boneTender:/(?:骨点|骨面|骨头|胫骨|足背|脚背|跖骨).{0,14}(?:点状压痛|(?:一个|一小)?点.{0,6}(?:痛|疼)|一点.{0,4}(?:按|压).{0,3}(?:痛|疼)|局部.{0,5}(?:压痛|疼|痛)|(?:按|压).{0,5}(?:痛|疼))/g,
 functionalPain:/(?:拉伤|扭伤).{0,10}(?:走路|行走|负重).{0,5}(?:痛|疼)|(?:走路|行走|负重).{0,5}(?:痛|疼)|无法负重/g,
 worseningPain:/越跑越(?:痛|疼)|越(?:练|运动)越(?:痛|疼)|跑起来.{0,6}(?:加重|更痛|更疼|越来越痛|越来越疼)|(?:痛|疼).{0,4}(?:逐渐|逐步|越来越|进行性).{0,4}(?:加重|厉害)|每一步都(?:痛|疼)|疼痛逐渐加重/g,
 review:/贫血|铁蛋白|血红蛋白|缺铁|补铁剂|补铁|持续疲劳|头晕|恶心|想吐/g,
 danger:/吐血|呕血|黑便|便血|酱油色尿|茶色尿|可乐色尿|尿色像可乐|尿液呈可乐色|红色尿/g,
 darkUrine:/(?:尿|小便).{0,10}(?:深色|很深|特别深|非常深|异常深|深褐|棕|褐|酱油|浓茶|可乐)|(?:深色|深褐色|棕色|褐色)尿/g,
 severeLimb:/(?:手臂|胳膊|大腿|小腿|腿|肢体|肌肉).{0,10}(?:明显肿|肿得|肿胀|剧痛|痛得厉害|非常痛|疼得厉害)|(?:剧痛|明显肿胀).{0,6}(?:肢体|肌肉|腿)/g,
 psychological:/伤害自己|自杀|自残|不想活|想死|结束生命/g,
} as const
export type SymptomDimension=keyof typeof SYMPTOM_DIMENSIONS
export type RedFlagMention={dimension:SymptomDimension;text:string;clause:string;negated:boolean;polarity:'ASSERTED'|'DENIED'|'UNCERTAIN';temporal:RedFlagTemporal;subject:RedFlagSubject;region:string|null}
const otherPerson=/队友|学员|孩子|女儿|儿子|同伴|同学|朋友|妹妹|姐姐|弟弟|哥哥|母亲|父亲|妈妈|爸爸|家人|妻子|丈夫|他|她|有人/;
const subjectTokens=/我(?:的)?(?:队友|学员|孩子|女儿|儿子|同伴|同学|朋友|妹妹|姐姐|弟弟|哥哥|母亲|父亲|妈妈|爸爸|家人|妻子|丈夫)|队友|学员|孩子|女儿|儿子|同伴|同学|朋友|妹妹|姐姐|弟弟|哥哥|母亲|父亲|妈妈|爸爸|家人|妻子|丈夫|他|她|有人|我|本人|咱/g;
const bodyRegion=/膝盖|膝关节|小腿|大腿后侧|大腿|跟腱|脚踝|足底|手腕|胳膊|肩膀|髋部|膝|腿|踝|脚|足|腰|背|肩|肘|髋|臀|胸/;
/** Pain matches may include the body part before a negator, or occur in a denied list. */
function painMentionNegated(clause:string,index:number,mention:string):boolean{
 const before=clause.slice(0,index).replace(SYMPTOM_DIMENSIONS.pain,'疼痛')
 const scoped=before+mention+clause.slice(index+mention.length)
 const assertion=before+mention
 // “不是没有腿疼” is an assertion, not absence of pain.
 if(/(?:不是|并非|不代表|不能说|无法说).{0,12}(?:没有|无|不)/.test(assertion))return false
 const symptom=[...mention.matchAll(/[疼痛]/g)].at(-1)?.index
 return /(?:不是|并非)$/.test(before)
  || negatedAt(scoped,before.length,mention.length)
  || symptom!==undefined&&negatedAt(scoped,before.length+symptom,mention.length-symptom)
}
/** Only explicit resolution of an ordinary recent body-part report changes its time scope.
 * Historical evidence still requests review; it never grants training clearance. */
function resolvedRecentPain(clause:string,nextClause:string,mention:string):boolean{
 if(!/昨天|前天|上次/.test(clause)||!/腿|膝|脚|足|跟腱|肩|腕|胳膊|髋/.test(mention))return false
 if(/锐痛|刺痛|剧痛|骨|肿胀|跛行|走路|行走|负重|加重|越来越/.test(clause))return false
 const resolution=clause.slice(clause.indexOf(mention)+mention.length)+'，'+nextClause
 return /(?:现在|目前)(?:已经|已)?(?:完全好了|完全缓解|完全不疼了|完全不痛了|不疼了|不痛了)/.test(resolution)
}
/** One mention projection supplies red-flag triage and R5 input semantics. */
export function readRedFlagMentions(text:string,context:RedFlagContext={}):RedFlagMention[]{
 const clauses=temporalContextClauses(normalizeCoachText(text).slice(0,16000)),hits:RedFlagMention[]=[]
 let carried:RedFlagSubject=context.subject??'UNKNOWN'
 for(const [clauseIndex,{text:clause,temporal}] of clauses.entries()){
  const subjects=[...clause.matchAll(subjectTokens)]
  for(const [dimension,re] of Object.entries(SYMPTOM_DIMENSIONS) as [SymptomDimension,RegExp][]){
   for(const m of clause.matchAll(re)){
    // Broad anatomical pain patterns must not convert ordinary soreness into pain.
    // The existing posterior-thigh/functional-warning rules remain separate.
    if(dimension==='pain'&&/酸痛|酸胀/.test(m[0])&&!/大腿后侧|刺痛|锐痛|疼|跛行|负重|走路/.test(m[0]))continue;
    const negated=dimension==='pain'?painMentionNegated(clause,m.index??0,m[0]):negatedAt(clause,m.index??0,m[0].length)
    const resolved=dimension==='pain'&&resolvedRecentPain(clause,clauses[clauseIndex+1]?.text??'',m[0])
    const token=subjects.filter(s=>s.index!<=(m.index??0)).at(-1)?.[0]
    const subject=context.subject??(token?(otherPerson.test(token)?'OTHER':'SELF'):carried)
    const local=clause.slice(Math.max(0,(m.index??0)-6),(m.index??0)+m[0].length)
    const uncertain=/不确定|不清楚|说不清|好像|可能|难道|难不成/.test(clause);
    hits.push({dimension,text:m[0],clause,subject,region:m[0].match(bodyRegion)?.[0]??local.match(bodyRegion)?.[0]??null,negated,polarity:uncertain?'UNCERTAIN':negated?'DENIED':'ASSERTED',temporal:temporal==='CURRENT'?unassertedAt(clause,m.index??0,m[0].length)??(resolved?'HISTORY':temporal):temporal})
   }
  }
  const token=subjects.at(-1)?.[0];if(token)carried=otherPerson.test(token)?'OTHER':'SELF'
 }
 return hits
}
export function detectRedFlags(text:string,context:RedFlagContext={}):RedFlagResult{
 const q=normalizeCoachText(text).slice(0,16000)
 const subject:RedFlagSubject=context.subject??(/队友|学员|孩子|女儿|儿子|同伴|同学|朋友|妹妹|姐姐|弟弟|哥哥|母亲|父亲|妈妈|爸爸|家人|妻子|丈夫|他(?:现在|刚|跑|练|说|的|已经)|她(?:现在|刚|跑|练|说|的|已经)|有人/.test(q)?'OTHER':/我|本人|咱/.test(q)?'SELF':'UNKNOWN')
 const globalTemporal:RedFlagTemporal=textTemporal(q)
 const clauses=temporalContextClauses(q)
 let carried:RedFlagSubject=context.subject??'UNKNOWN';
 const currentText=clauses.filter(clause=>{
  const token=[...clause.text.matchAll(subjectTokens)].at(-1)?.[0];
  if(token)carried=otherPerson.test(token)?'OTHER':'SELF';
  return clause.temporal==='CURRENT'&&(!context.excludeOtherSubjects||carried!=='OTHER');
 }).map(clause=>clause.text).join('，')
 const hits=readRedFlagMentions(q,context).filter(h=>!context.excludeOtherSubjects||h.subject!=='OTHER')
 const active=hits.filter(h=>!h.negated&&h.temporal==='CURRENT'),has=(d:SymptomDimension)=>active.some(h=>h.dimension===d)
 const historical=hits.filter(h=>!['soreness','weightGoal','energyConcern'].includes(h.dimension)&&!h.negated&&h.temporal==='HISTORY')
 const resolvedMildDizziness=/(?:轻微|轻度|有点|有一点|稍微).{0,3}(?:头晕|晕)|(?:头晕|晕).{0,3}(?:轻微|轻度|一点点)/.test(q)&&/(?:已经|已|现在|目前|休息后).{0,5}(?:完全)?(?:缓解|好了|恢复正常|不晕了|没事了)/.test(q)&&!/(?:仍|还|又).{0,3}(?:头晕|晕)/.test(q)
 const classes:RedFlagClass[]=[];let level:RedFlagLevel='NONE'
 const raise=(next:RedFlagLevel,kind:RedFlagClass)=>{if(!classes.includes(kind))classes.push(kind);if(RED_FLAG_PRIORITY[next]>RED_FLAG_PRIORITY[level])level=next}
 const exercise=context.exerciseRelated||/跑|训练|运动|冲刺|练|骑车|游泳|球|健身|加量/.test(currentText)
 const temperature=temperatureFromText(currentText),heat=has('heat')||(temperature!==null&&temperature>=30)
 if(has('arrest')||has('unresponsive')&&(has('noNormalBreath')||has('seizure')))raise('EMERGENCY','CARDIAC_ARREST')
 if(has('darkUrine')&&has('severeLimb'))raise('EMERGENCY','OTHER')
 if(has('collapse')&&has('unresponsive'))raise('EMERGENCY','SYNCOPE')
 if((has('throat')&&(has('allergyExposure')||has('swelling')||has('breath')||has('breathWorsening')))||(has('allergyExposure')&&has('swelling')&&(has('breath')||has('breathWorsening'))))raise('EMERGENCY','ALLERGY')
 if(has('systemicAllergy')&&(has('breath')||has('throat')||has('breathWorsening')))raise('EMERGENCY','ALLERGY')
 if(heat&&(has('mental')||has('speech')||has('dry')||has('chills')||has('seizure')||has('syncope')||has('vomiting')))raise('EMERGENCY','HEAT')
 else if(heat&&(has('review')||has('breath')))raise('MEDICAL_REVIEW','HEAT')
 if(has('chest'))raise('EMERGENCY','CARDIOVASCULAR') // Preserve the existing conservative chest symptom boundary.
 const hr=heartRateFromText(currentText),duration=symptomDurationMinutes(currentText)
 if(hr!==null&&hr>=120&&duration!==null&&duration>=10&&/休息|静坐|躺着|安静/.test(currentText))raise('URGENT_MEDICAL','CARDIOVASCULAR')
 if(has('palpitation'))raise(has('chest')||has('syncope')?'EMERGENCY':'URGENT_MEDICAL','CARDIOVASCULAR')
 if(has('syncope')||has('seizure'))raise('EMERGENCY','SYNCOPE')
 const strokePattern=has('unilateral')&&(!has('back')||active.some(h=>h.dimension==='unilateral'&&!/腿|脚|下肢/.test(h.text)))
 if(strokePattern||has('speech')||has('vision')||has('grip')||(has('mental')&&exercise)||has('bladder'))raise('EMERGENCY','NEUROLOGICAL')
 else if(has('back')&&has('legNerve'))raise('URGENT_MEDICAL','NEUROLOGICAL')
 if(has('severeBreath')||has('cyanosis')||has('breathWorsening')&&has('cyanosis')||has('breath')&&has('cyanosis'))raise('EMERGENCY','RESPIRATORY')
 else if(has('breath'))raise(has('illness')?'URGENT_MEDICAL':'MEDICAL_REVIEW','RESPIRATORY')
 if(has('illness'))raise(has('palpitation')||has('breath')?'URGENT_MEDICAL':'MEDICAL_REVIEW','POST_ILLNESS')
 const intake=energyIntakeFromText(currentText)
 if(has('energy')||(exercise&&intake!==null&&intake<1800))raise('MEDICAL_REVIEW','ENERGY')
 // A weight goal alone is ordinary coaching. Preserve the existing review
 // boundary when that person's goal co-occurs with deterioration or daily extra training.
 if(active.some(h=>h.dimension==='weightGoal'&&active.some(c=>c.dimension==='energyConcern'&&c.subject===h.subject)))raise('MEDICAL_REVIEW','ENERGY')
 if(has('pain')||has('functionalPain')||has('boneTender'))raise('MEDICAL_REVIEW','PAIN')
 if(active.some(h=>h.dimension==='review'&&!(resolvedMildDizziness&&h.text==='头晕')))raise('MEDICAL_REVIEW','OTHER')
 if(has('danger'))raise('EMERGENCY','OTHER')
 if(has('psychological'))raise('EMERGENCY','PSYCHOLOGICAL')
 const age=context.ageYears??ageFromText(context.excludeOtherSubjects?currentText:q)
 if(age!==null&&age!==undefined&&age>0&&age<18){
  raise(/1rm|极限|最大重量|冲重量|每天.{0,8}练/.test(currentText)?'MEDICAL_REVIEW':'NONE','YOUTH')
 }
 if(historical.some(h=>!(resolvedMildDizziness&&h.dimension==='review'&&h.text==='头晕'))&&level==='NONE')raise('MEDICAL_REVIEW','OTHER')
 const scene:RedFlagScene=/(?:晚上|夜里|回家|在家|家里|室友|卧室)/.test(currentText)&&!/(?:正在|现在在).{0,4}(?:跑|训练|运动)/.test(currentText)?'HOME_AFTER':/(?:正在|现在在?)(?:跑|练|运动)|跑步时|跑步中|训练时|跑着|跑到|训练中|运动中|跑步时|刚停|场地|操场|球场/.test(currentText)?'TRAINING':'UNKNOWN'
 const result:RedFlagResult={scene,level,classes,subject,negated:hits.some(h=>h.negated)&&!active.length,temporal:globalTemporal,evidence:[...new Set(active.map(h=>h.text))]}
 if(context.prior&&RED_FLAG_PRIORITY[context.prior.level]>RED_FLAG_PRIORITY[result.level])return {...context.prior,classes:[...new Set([...context.prior.classes,...classes])]}
 return result
}
export function redFlagResponse(result:RedFlagResult):string|null{
 const other=result.subject==='OTHER',person=other?'请在场的人立即协助当事人停止运动':'请立即停止运动'
 const guardian=result.classes.includes('YOUTH')?'同时联系监护人到场参与处理。':''
 if(result.level==='EMERGENCY'){
  // Product decision 2026-10-13: 2–4 scenario-specific sentences, not a first-aid manual.
  let actions:string[]
  if(other)actions=['请在场的人立即协助当事人停止活动，你现在就拨打120急救电话。','留在当事人身边陪同，并按120调度员的指导做。']
  else if(result.scene==='TRAINING')actions=['立即停止运动，原地坐下或躺下，不要继续跑或自己走远。','马上拨打120急救电话，请身边的人帮忙拨打并陪着你。']
  else if(result.scene==='HOME_AFTER')actions=['停止活动，立即拨打120急救电话，不要自己开车去医院。','告诉家人或室友，待在容易被找到的位置，门别反锁。']
  else actions=['停止活动，立即拨打120急救电话，寻求急诊救治。','请身边的人协助并陪同，告知急救人员你的位置，不要自己开车。']
  if(result.classes.includes('CARDIAC_ARREST'))actions=['你现在就拨打120并开免提，留在当事人身边并请其他在场的人取AED。','当事人无反应且没有正常呼吸或只有喘息时，立即按120调度员指导开始心肺复苏（胸外按压），AED到达后按语音提示使用。','持续施救，直到急救人员接手或调度员要求停止。']
  else if(result.classes.includes('ALLERGY'))actions.push('如有本人自备的肾上腺素笔，按既有医嘱或说明使用，同时等待急救。')
  else if(result.classes.includes('HEAT'))actions.push('等待急救时立即转移到阴凉处并开始降温，请身边人协助。')
  if(guardian)actions.push(guardian)
  return actions.join('')
 }
 if(result.level==='URGENT_MEDICAL'){
  const actions=[`${other?'请陪同当事人':'请'}今天停止训练，尽快就医评估；即使暂时缓解也不安排补课。`]
  if(result.classes.includes('CARDIOVASCULAR'))actions.push('告知医生心跳异常的开始时间、持续情况及休息后的变化。')
  if(result.classes.includes('NEUROLOGICAL'))actions.push('同时评估腰背、肢体感觉或力量变化，避免搬扭和负重。')
  if(result.classes.includes('RESPIRATORY'))actions.push('告知医生呼吸异常及日常活动受到的影响。')
  if(result.classes.includes('POST_ILLNESS'))actions.push('告知医生近期生病及症状出现时间。')
  if(result.classes.includes('HEAT'))actions.push('离开闷热暴晒环境，休息降温并告知热暴露经过。')
  if(result.classes.includes('PAIN'))actions.push('停止诱发疼痛的动作，并告知疼痛部位。')
  if(result.classes.includes('ENERGY'))actions.push('不要加量或继续压低摄入，同时安排运动医学和营养评估。')
  if(result.classes.includes('OTHER'))actions.push('把头晕、恶心或其他不适一并告诉医生。')
  return actions.join('')+guardian
 }
 if(result.level==='MEDICAL_REVIEW'){
  const parts:string[]=[]
  if(result.classes.includes('ENERGY'))parts.push('先不加量，也不要继续压低摄入；这些线索需要运动医学和营养专业评估，成绩变化不能证明它们正常。')
  if(result.classes.includes('ENERGY')&&result.classes.includes('YOUTH')&&/闭经|停经|月经|姨妈|例假/.test(result.evidence.join('')))parts.push('青少年月经停止或持续异常应联系医生评估，不能当作训练后的正常现象；可能需要减少训练量，具体安排由医生与现场教练结合评估确认。')
  if(result.classes.includes('POST_ILLNESS'))parts.push('仍发热或全身不适时暂停运动；病后先核对日常活动与症状反应，不补课追进度，必要时咨询医生。')
  if(result.classes.includes('PAIN'))parts.push(/走路|行走|负重|骨点|压痛|越跑越/.test(result.evidence.join(''))?'今天停止跑跳及诱发疼痛的动作，尽快联系运动医学或康复专业人员评估；影响行走或骨点疼痛加重时不要用试跑判断能否继续。':'先停止诱发疼痛的动作，必要时寻求运动医学或康复专业评估；低疼痛分数不等于可以继续。')
  if(result.classes.includes('HEAT'))parts.push('立即停止运动，离开闷热暴晒环境到阴凉处，松解多余衣物并用凉水、湿毛巾等持续降温，请身边人陪同。若意识模糊、说话异常、抽搐、明显高热或降温后没有改善，立即拨打120；清醒且能吞咽时可小口饮水，不向意识异常者喂水。')
  if(result.classes.includes('RESPIRATORY'))parts.push('先停止诱发气短的运动，核对呼吸不适是否持续或影响日常活动，必要时就医评估。')
  if(result.classes.includes('YOUTH'))parts.push('请监护人参与并联系合格专业教练评估；可以学习规范动作，不远程安排极限测试。')
  if(result.classes.includes('OTHER')&&/贫血|铁蛋白|血红蛋白|缺铁|补铁/.test(result.evidence.join('')))parts.push('铁缺乏与贫血需要分别评估；请结合血常规、铁蛋白和症状咨询医生，不自行按聊天建议服用治疗剂量补铁；没有修改计划或记录。')
  if(!parts.length)parts.push('先核对症状与既往记录，必要时寻求医生或相关专业评估，不能通过聊天判断原因。')
  parts.push(result.classes.includes('ENERGY')?'进食、月经或伤病变化持续多久，是否已影响日常活动？':result.classes.includes('POST_ILLNESS')?'现在还有发热、乏力或日常活动不适吗？':result.classes.includes('YOUTH')&&!result.classes.includes('PAIN')?'你目前的力量训练经验如何，是否有合格教练现场指导？':'具体何时出现，目前是否持续或影响日常活动？')
  return parts.join('')
 }
 return null
}
