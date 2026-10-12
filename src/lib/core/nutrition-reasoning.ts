/** V20 offline nutrition evidence calculations. Educational only; no diagnosis or prescription. */
import {triageNutrition} from './nutrition-safety.ts';
export type CalcResult = {status:'CALCULATED'|'INSUFFICIENT_DATA'|'INVALID_INPUT'; value:number|null; unit:string; formula:string; limitations:string[]; decisionAuthorization:false};
const finitePositive=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const result=(status:CalcResult['status'],value:number|null,unit:string,formula:string,limitations:string[]):CalcResult=>({status,value,unit,formula,limitations,decisionAuthorization:false});
/** EA = (dietary energy intake - exercise energy expenditure)/fat-free mass. Estimates do not diagnose RED-S. */
export function energyAvailability(input:{intakeKcal?:number;exerciseKcal?:number;fatFreeMassKg?:number}):CalcResult{
 const {intakeKcal:i,exerciseKcal:e,fatFreeMassKg:m}=input;
 const note=['输入数据可能有测量误差；单日能量可用性不能诊断或排除RED-S','不是每日热量盈亏或总能量平衡'];
 if(i===undefined||e===undefined||m===undefined)return result('INSUFFICIENT_DATA',null,'kcal/kg FFM/day','(intakeKcal - exerciseKcal) / fatFreeMassKg',note);
 if(!finitePositive(i)||typeof e!=='number'||!Number.isFinite(e)||e<0||!finitePositive(m))return result('INVALID_INPUT',null,'kcal/kg FFM/day','(intakeKcal - exerciseKcal) / fatFreeMassKg',note);
 return result('CALCULATED',Math.round(((i-e)/m)*100)/100,'kcal/kg FFM/day','(intakeKcal - exerciseKcal) / fatFreeMassKg',note);
}
/** Arithmetic difference only; not a caloric deficit without total expenditure. */
export function intakeMinusExercise(intakeKcal?:number,exerciseKcal?:number):CalcResult{
 const caveats=['仅为摄入减去运动消耗，不能当作热量缺口；还缺静息代谢、日常活动及其他能量消耗'];
 if(intakeKcal===undefined||exerciseKcal===undefined)return result('INSUFFICIENT_DATA',null,'kcal','intakeKcal - exerciseKcal',caveats);
 if(!finitePositive(intakeKcal)||typeof exerciseKcal!=='number'||!Number.isFinite(exerciseKcal)||exerciseKcal<0)return result('INVALID_INPUT',null,'kcal','intakeKcal - exerciseKcal',caveats);
 return result('CALCULATED',intakeKcal-exerciseKcal,'kcal','intakeKcal - exerciseKcal',caveats);
}
/** Converts a user-supplied carbohydrate target to grams; does not set target. */
export function carbTargetGrams(weightKg?:number,targetGPerKg?:number):CalcResult{
 const note=['目标g/kg须来自经核实的训练情境与个人耐受；本函数不推荐目标','胃肠耐受、训练时长与赛前安排需单独评估'];
 if(weightKg===undefined||targetGPerKg===undefined)return result('INSUFFICIENT_DATA',null,'g/day','weightKg * targetGPerKg',note);
 if(!finitePositive(weightKg)||!finitePositive(targetGPerKg))return result('INVALID_INPUT',null,'g/day','weightKg * targetGPerKg',note);
 return result('CALCULATED',Math.round(weightKg*targetGPerKg*10)/10,'g/day','weightKg * targetGPerKg',note);
}
export type NutritionReview = {domain:ReturnType<typeof triageNutrition>['domain']; safety:ReturnType<typeof triageNutrition>['safety']; requiresClinicalReview:boolean; questions:string[]; knowledgeBoundaries:string[]; decisionAuthorization:false; diagnosis:null};
export function reviewNutritionQuestion(question:string):NutritionReview{
 const t=triageNutrition(question); const questions=[...t.evidenceGaps]; const boundaries=[...t.cautions];
 if(t.domain==='IRON_ANEMIA')boundaries.push('血红蛋白、铁蛋白、炎症状态及参考范围需结合临床情境；不根据单一数值给补铁剂量');
 if(t.domain==='ENERGY_AVAILABILITY')boundaries.push('低能量可用性与RED-S不是同义词；需要纵向症状及专业评估');
 if(t.domain==='RACE_DAY')boundaries.push('短跑/中跑与长距离项目补给策略不同；不在赛日首次试用新食物');
 return {domain:t.domain,safety:t.safety,requiresClinicalReview:t.safety!=='NONE',questions,knowledgeBoundaries:boundaries,decisionAuthorization:false,diagnosis:null};
}
