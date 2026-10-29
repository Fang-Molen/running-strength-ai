import type {FoodRow} from './food-db';

/** No authorised catalogue adapter is wired. /api/food-estimate is model inference. */
export const foodSearchReadiness={configured:false,provider:null,status:'unconfigured',message:'在线食物搜索未配置；可继续使用本地食物库或自己填写。'} as const;
export function foodResultDetails(food:FoodRow){
 const qualifier=food.n.match(/[（(](生|熟)(?:重)?[）)]/)?.[1];
 const english=food.n.match(/\b(raw|cooked)\b/i)?.[1]?.toLowerCase();
 return {source:'本地食物库',brand:food.br?.trim()||'未标注',region:food.rg?.trim()||'未标注',preparation:qualifier||(english==='raw'?'生':english==='cooked'?'熟':'未标注'),basis:food.b==='g'?'每100g':'每份'};
}
