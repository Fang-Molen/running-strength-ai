/** V21 offline, educational contextual nutrition knowledge. No automatic prescriptions. */
import {reviewNutritionQuestion} from './nutrition-reasoning.ts';
export type Event = '800m'|'1500m'|'5000m'|'10000m'|'half-marathon'|'marathon'|'unknown';
export type SessionDay = 'rest'|'easy'|'quality'|'race'|'unknown';
export type NutritionContext = {question:string;event?:Event;day?:SessionDay;raceStartTime?:string;trainingDurationMin?:number;priorGIProblems?:boolean;recentWeightLoss?:boolean;fatigue?:boolean;ferritin?:number;hemoglobin?:number;labReference?:string};
export type ContextResult = {topic:string;facts:string[];missing:string[];questions:string[];safety:'NONE'|'MEDICAL_REVIEW'|'URGENT_REVIEW'|'EMERGENCY';decisionAuthorization:false;diagnosis:null;individualPrescription:false};
const add=(xs:string[],x:string)=>{if(!xs.includes(x))xs.push(x)};
export function contextualNutrition(input:NutritionContext):ContextResult {
 const base=reviewNutritionQuestion(input.question); const facts=[...base.knowledgeBoundaries], missing=[...base.questions].filter(x=>!(input.raceStartTime&&x.includes('开赛时间'))&&!(input.event&&input.event!=='unknown'&&x.includes('项目距离'))&&!(input.priorGIProblems!==undefined&&x.includes('胃肠耐受'))),questions:string[]=[];
 const q=input.question.toLowerCase();const event=input.event??'unknown';const day=input.day??'unknown';
 const iron=base.domain==='IRON_ANEMIA'||/贫血|铁蛋白|缺铁|ferritin|hemoglobin|血红蛋白/.test(q);
 const race=base.domain==='RACE_DAY'||day==='race';const energy=base.domain==='ENERGY_AVAILABILITY'||input.recentWeightLoss===true;
 if(day==='rest')add(facts,'休息日仍有基础代谢、组织修复和恢复需求；不能默认零碳水或极低热量');
 if(day==='quality')add(facts,'高强度训练日的碳水供应与训练前后可耐受的进食时间相关；需依据总训练量调整');
 if(day==='easy')add(facts,'轻松训练日的补给取决于持续时间、前后训练安排与全天摄入，而不只看本次强度');
 if(day==='unknown'&&/训练日|休息日|碳水|热量|补给/.test(q))add(missing,'当天训练类型、持续时间及前后训练安排');
 if(race){
  if(event==='unknown')add(missing,'具体比赛项目与预计持续时间');
  if(!input.raceStartTime)add(missing,'开赛时间与可进食窗口');
  if(input.priorGIProblems===undefined)add(missing,'既往比赛胃肠耐受情况');
  add(facts,'赛前补给应提前在训练中演练，不在比赛当天首次尝试新食物、补剂或高浓度饮料');
  if(event==='800m'||event==='1500m')add(facts,'800米和1500米比赛期间通常无需像马拉松那样边跑边补给；赛前全天供能和胃肠舒适度更重要');
  if(event==='5000m'||event==='10000m')add(facts,'5000米与10000米补给需要结合实际完赛时长和环境；不可照搬马拉松比赛中补给方案');
  if(event==='half-marathon'||event==='marathon')add(facts,'半马和马拉松更需要评估比赛期间的碳水、液体摄入与肠胃训练；具体目标必须考虑预计时长和耐受');
 }
 if(iron){
  add(facts,'铁蛋白反映铁储备的一部分；正常血红蛋白不排除铁储备不足，低铁蛋白也不自动等于缺铁性贫血');
  add(facts,'铁蛋白可能受炎症影响；检验单位、实验室参考范围和完整血常规均影响解读');
  if(input.ferritin!==undefined){if(!Number.isFinite(input.ferritin)||input.ferritin<0)add(missing,'有效的铁蛋白测量值与单位');else add(facts,'已提供铁蛋白数值，但不能仅凭此数值诊断或决定铁剂剂量');}
  if(input.hemoglobin===undefined)add(missing,'血红蛋白及血常规结果');
  if(!input.labReference)add(missing,'检验单位、参考区间与采样时临床背景');
  add(questions,'是否有持续疲劳、气促、心悸、出血或饮食限制，是否已由医生评估？');
 }
 if(energy){add(facts,'持续能量不足可能影响训练适应和健康；单日摄入、手表消耗或体重变化均不能单独诊断RED-S');if(input.recentWeightLoss||input.fatigue)add(questions,'近期体重趋势、训练量、睡眠、恢复、骨痛及其他症状是否持续变化？');}
 if(input.priorGIProblems===true)add(facts,'有胃肠不适史时应优先评估既往可耐受食物和赛前进食间隔，避免临赛实验');
 let safety=base.safety;
 if(iron&&(input.fatigue===true||input.ferritin!==undefined)&&safety==='NONE')safety='MEDICAL_REVIEW';
 if(energy&&input.recentWeightLoss===true&&input.fatigue===true&&safety==='NONE')safety='MEDICAL_REVIEW';
 if(input.trainingDurationMin!==undefined&&(!Number.isFinite(input.trainingDurationMin)||input.trainingDurationMin<0))add(missing,'有效训练持续时间');
 return {topic:iron?'IRON_ANEMIA':race?'RACE_FUELING':energy?'ENERGY_AVAILABILITY':'TRAINING_FUELING',facts,missing,questions,safety,decisionAuthorization:false,diagnosis:null,individualPrescription:false};
}
