/** Offline, conservative nutrition triage. Not a diagnosis or prescription. */
export type NutritionDomain = 'ENERGY_AVAILABILITY'|'FUELING'|'RACE_DAY'|'IRON_ANEMIA'|'SUPPLEMENTS'|'OTHER';
export type NutritionTriage = {domain:NutritionDomain; safety:'NONE'|'MEDICAL_REVIEW'|'URGENT_REVIEW'|'EMERGENCY'; evidenceGaps:string[]; cautions:string[]; decisionAuthorization:false; diagnosis:null};
const has=(s:string,p:RegExp)=>p.test(s);
export function triageNutrition(question:string):NutritionTriage {
 const s=question.toLowerCase();
 const iron=has(s,/贫血|缺铁|铁蛋白|血红蛋白|补铁|铁剂|ferritin|anemia|haemoglobin|hemoglobin/);
 const energy=has(s,/热量|能量缺口|能量可用性|red-s|月经|闭经|体重下降|减重|掉体重|应力性骨折|低性欲/);
 const race=has(s,/赛前|比赛前|决赛|预赛|马拉松前|半马前|早餐/);
 const supplement=has(s,/补剂|咖啡因|咖啡|铁剂|肌酸|电解质片/);
 const fueling=has(s,/碳水|蛋白质|补给|吃什么|饮食|空腹|喝水|水分|运动饮料|进食/);
 const domain:NutritionDomain=iron?'IRON_ANEMIA':energy?'ENERGY_AVAILABILITY':race?'RACE_DAY':supplement?'SUPPLEMENTS':fueling?'FUELING':'OTHER';
 const emergency=has(s,/昏厥|晕厥|意识丧失|胸痛.{0,12}(呼吸困难|晕厥)|呼吸困难.{0,12}胸痛/);
 const urgent=has(s,/尿液(变红|红色|血红)|血尿|心悸.{0,12}(头晕|晕)|头晕.{0,12}心悸/);
 const medical=has(s,/月经停止|闭经|应力性骨折|反复.{0,8}骨折|血红蛋白偏低|铁蛋白.{0,8}(低|12|10)|缺铁性贫血|贫血|铁剂|补铁|red-s|低性欲.{0,10}疲劳/);
 const safety=emergency?'EMERGENCY':urgent?'URGENT_REVIEW':medical?'MEDICAL_REVIEW':'NONE';
 const evidenceGaps:string[]=[]; const cautions:string[]=[];
 if(domain==='ENERGY_AVAILABILITY') { evidenceGaps.push('完整摄入、训练总消耗及个体背景；如需估算能量可用性还需去脂体重和运动能量消耗'); cautions.push('手表消耗与摄入相减不等于精确能量可用性；不要仅凭单次数据判定RED-S'); }
 if(domain==='IRON_ANEMIA'){evidenceGaps.push('血常规、铁蛋白及相关铁代谢指标、症状和临床评估');cautions.push('低铁蛋白不自动等于缺铁性贫血；不自行规定补铁治疗剂量');}
 if(domain==='RACE_DAY'){evidenceGaps.push('项目距离、开赛时间、既往胃肠耐受及饮食习惯');cautions.push('避免比赛当天首次尝试高剂量补剂或陌生食物');}
 if(domain==='FUELING'){evidenceGaps.push('运动持续时间、强度、气温和既往胃肠耐受');}
 if(domain==='SUPPLEMENTS'){cautions.push('不能在缺乏个人风险和既往耐受信息时推荐高剂量补剂');}
 if(safety==='URGENT_REVIEW') cautions.push('出现血尿或心悸伴头晕等情况应尽快就医，不应仅靠饮食或补铁处理');
 if(safety==='EMERGENCY') cautions.push('出现胸痛伴呼吸困难、晕厥等严重症状时应立即寻求急救');
 return {domain,safety,evidenceGaps,cautions,decisionAuthorization:false,diagnosis:null};
}
