/** A bounded reference to an existing plan/capacity is not a new dose or a
 * completed activity. Roles and units must match, not just the same digits. */
import {affirmed,validateCoachAssertions,type CoachAssertionOptions} from './assertion-policy';
export function plannedAdviceActionIsSafe(text:string,options:CoachAssertionOptions):boolean{
 if(!affirmed(text,/保留|维持|继续|执行|照常/))return true;
 const activity=/轻松跑|跑步|冲刺|深蹲|硬拉|卧推|弯举|训练|练习/.exec(text)?.[0];
 return !activity||validateCoachAssertions('你可以继续'+activity.replace('轻松跑','跑步')+'。',{...options,factQuotes:[],citedQuotes:[]}).ok;
}
const number='[0-9]+(?:\\.[0-9]+)?|[一二两三四五六七八九十]';
const unit='分钟|min|小时|公里|千米|km|公斤|kg|米|m|秒|组|次|天|周';
export function adviceQuantities(text:string){return [...text.normalize('NFKC').matchAll(new RegExp('('+number+')\\s*('+unit+')','gi'))].map(m=>({raw:m[0],n:m[1],u:m[2].toLowerCase()}));}
const equivalent=(n:string,u:string)=>{const values:Record<string,number>={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};const value=values[n]??Number(n);const units:Record<string,[string,number]>={分钟:['time',60],min:['time',60],小时:['time',3600],秒:['time',1],公里:['distance',1000],千米:['distance',1000],km:['distance',1000],米:['distance',1],m:['distance',1],公斤:['weight',1],kg:['weight',1]};const [dimension,multiplier]=units[u]??[u,1];return dimension+':'+value*multiplier;};
export function boundExistingPlanAdvice(text:string,question:string,quotes:readonly string[]):boolean{
 if(affirmed(text,/压缩成|压成|合并到|叠加|塞进/))return false;
 if(!/若|如果|是否|需结合|可考虑|可以先|先考虑|建议|原计划|优先保留/.test(text)||/已完成|完成了|实际完成|已经跑|已经做|肯定能|一定能/.test(text))return false;
 const planned=[question,...quotes].flatMap(s=>s.split(/[，,。；;\n]/)).filter(s=>/原计划|原课表|可练|可用|只能(?:训练|练|完成)|可以完成/.test(s));
 const allowed=planned.flatMap(adviceQuantities).map(q=>equivalent(q.n,q.u));
 const quantities=adviceQuantities(text);if(!quantities.length)return false;
 let rest=text;for(const q of quantities){if(!allowed.includes(equivalent(q.n,q.u)))return false;rest=rest.replace(q.raw,'');}
 return !/[0-9]/.test(rest);
}
