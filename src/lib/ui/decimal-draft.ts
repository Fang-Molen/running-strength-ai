/** UI-only parsing: never changes units or rounds persisted numbers. */
export type DecimalRules={min?:number;max?:number;integer?:boolean;nullable?:boolean};
export type DecimalResult={ok:true;value:number|null}|{ok:false;reason:string};
export function parseDecimalDraft(raw:string,rules:DecimalRules={}):DecimalResult{
 const text=raw.normalize('NFKC').trim();
 if(!text)return rules.nullable?{ok:true,value:null}:{ok:false,reason:'请填写数值，空白不等于0'};
 // One comma is explicitly a decimal separator, never a thousands separator.
 if(!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text))return {ok:false,reason:'请填写有效数值；逗号按小数点处理，不支持千位分隔'};
 const value=Number(text.replace(',','.'));
 if(!Number.isFinite(value))return {ok:false,reason:'数值无效'};
 if(rules.integer&&!Number.isInteger(value))return {ok:false,reason:'此项需要整数'};
 if(rules.min!==undefined&&value<rules.min)return {ok:false,reason:`不能小于${rules.min}`};
 if(rules.max!==undefined&&value>rules.max)return {ok:false,reason:`不能大于${rules.max}`};
 return {ok:true,value};
}
