/** JSON.parse alone silently accepts duplicate policy/decision keys. This bounded
 * structural walk checks decoded object keys before returning parsed data. */
export function parseStrictJson(text:string,maxChars=12000):unknown{
 if(text.length>maxChars)throw Error('JSON_SIZE');
 const parsed:unknown=JSON.parse(text);let at=0;
 const ws=()=>{while(/\s/.test(text[at]??'')&&at<text.length)at++;};
 const string=():string=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at));}throw Error('JSON_STRING');};
 const value=(depth:number):void=>{
  if(depth>64)throw Error('JSON_DEPTH');ws();
  if(text[at]==='"'){string();return;}
  if(text[at]==='{'){at++;ws();const keys=new Set<string>();if(text[at]==='}'){at++;return;}while(at<text.length){ws();if(text[at]!=='"')throw Error('JSON_KEY');const key=string();if(keys.has(key))throw Error('JSON_DUPLICATE_KEY');keys.add(key);ws();if(text[at++]!==':')throw Error('JSON_COLON');value(depth+1);ws();const c=text[at++];if(c==='}')return;if(c!==',')throw Error('JSON_OBJECT');}throw Error('JSON_OBJECT');}
  if(text[at]==='['){at++;ws();if(text[at]===']'){at++;return;}while(at<text.length){value(depth+1);ws();const c=text[at++];if(c===']')return;if(c!==',')throw Error('JSON_ARRAY');}throw Error('JSON_ARRAY');}
  const literal=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));if(!literal)throw Error('JSON_VALUE');at+=literal[0].length;
 };
 value(0);ws();if(at!==text.length)throw Error('JSON_TRAILING');return parsed;
}
