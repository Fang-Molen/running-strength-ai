export type RetrievalPage={id:string;url:string;quote:string;fetchedAt:string;expiresAt:string};
export type RetrievalState={state:'NOT_NEEDED'|'REQUESTED'|'SUCCEEDED'|'PARTIAL'|'FAILED'|'STALE_CACHE';enabled:boolean;sources:RetrievalPage[]};
export function needsAnswerRetrieval(question:string){return /(?:查询|查找|搜索|检索|查证).{0,16}(?:最新|标签|文献|网页|资料)|最新.{0,8}(?:标签|研究)|这个网页|按检索结果/.test(question);}
/** Trusted adapter only. No model URL, history or write authorization is sent.
 * The preference is retained after failure; no automatic retry or model call. */
export async function resolveAnswerRetrieval(question:string,enabled:boolean,port?: (question:string,signal:AbortSignal)=>Promise<RetrievalPage[]>,clock:number|(()=>number)=Date.now):Promise<RetrievalState>{
 if(!needsAnswerRetrieval(question))return {state:'NOT_NEEDED',enabled,sources:[]};
 if(!enabled||!port)return {state:'FAILED',enabled,sources:[]};
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('RETRIEVAL_TIMEOUT'));},3000);});
  const raw=await Promise.race([port(question,controller.signal),timeout]);
  const now=typeof clock==='function'?clock():clock;
  const valid=raw.filter(s=>typeof s.id==='string'&&s.id.length<=120&&/^https?:\/\//.test(s.url)&&s.url.length<=1000&&s.quote.trim()&&s.quote.length<=1000&&Date.parse(s.fetchedAt)<=now&&Date.parse(s.expiresAt)>=now).slice(0,8);
  return {state:valid.length?(valid.length===raw.length?'SUCCEEDED':'PARTIAL'):'FAILED',enabled,sources:valid};
 }catch{return {state:'FAILED',enabled,sources:[]};}finally{clearTimeout(timer);}
}
/** Same trusted receipt representation at the controller and browser boundary. */
export function retrievalPageQuote(page:RetrievalPage){return page.quote+'（检索来源：'+page.url+'；取得时间'+page.fetchedAt+'）';}
export function validRetrievalState(value:unknown,now=Date.now()):value is RetrievalState{
 if(!value||typeof value!=='object')return false;const r=value as RetrievalState;
 if(!['NOT_NEEDED','REQUESTED','SUCCEEDED','PARTIAL','FAILED','STALE_CACHE'].includes(r.state)||typeof r.enabled!=='boolean'||!Array.isArray(r.sources)||r.sources.length>8)return false;
 const ids=new Set<string>();
 return r.sources.every(s=>{if(!s||typeof s.id!=='string'||ids.has(s.id)||s.id.length>120||typeof s.url!=='string'||!/^https?:\/\//.test(s.url)||s.url.length>1000||typeof s.quote!=='string'||!s.quote.trim()||s.quote.length>1000||!(Date.parse(s.fetchedAt)<=now&&Date.parse(s.expiresAt)>=now))return false;ids.add(s.id);return true;})&&(r.state!=='SUCCEEDED'||r.enabled&&r.sources.length>0);
}
export function checkedRetrievalProse(text:string,retrieval:RetrievalState|undefined,now:number):{ok:boolean;prose:string}{
 if(!retrieval||!validRetrievalState(retrieval,now)||retrieval.state!=='SUCCEEDED')return {ok:false,prose:text};
 const matching=retrieval.sources.filter(s=>text.includes(s.url)&&text.includes(s.quote));
 if(!matching.length)return {ok:false,prose:text};let prose=text;
 for(const s of matching)prose=prose.split(s.url).join('').split(s.quote).join('');
 prose=prose.replace(/(?:根据|依据)?本次(?:实际)?(?:查到|取得|检索到)的?(?:标签页|页面|资料)/g,'');
 return {ok:true,prose};
}
export type ActionBinding={requestId:string;owner:string;date:string;target:string;item:string;quantity:string;idempotencyKey:string};
export function actionReceiptMatches(intent:ActionBinding,receipt:ActionBinding&{status:string},currentOwner:string,authorized:boolean){
 return authorized&&currentOwner===intent.owner&&receipt.status==='SUCCEEDED'&&Object.keys(intent).every(k=>intent[k as keyof ActionBinding]===receipt[k as keyof ActionBinding])&&Object.values(intent).every(v=>typeof v==='string'&&v.length>0);
}
