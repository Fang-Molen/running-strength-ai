export type RetrievalPage={id:string;url:string;quote:string;fetchedAt:string;expiresAt:string};
export type RetrievalState={state:'NOT_NEEDED'|'REQUESTED'|'SUCCEEDED'|'PARTIAL'|'FAILED'|'STALE_CACHE';enabled:boolean;sources:RetrievalPage[]};
export function needsAnswerRetrieval(question:string){return /(?:查询|查找|搜索|检索|查证).{0,16}(?:最新|标签|文献|网页|资料)|最新.{0,8}(?:标签|研究)|这个网页/.test(question);}
/** Trusted adapter only. No model URL, history or write authorization is sent.
 * The preference is retained after failure; no automatic retry or model call. */
export async function resolveAnswerRetrieval(question:string,enabled:boolean,port?: (question:string,signal:AbortSignal)=>Promise<RetrievalPage[]>,now=Date.now()):Promise<RetrievalState>{
 if(!needsAnswerRetrieval(question))return {state:'NOT_NEEDED',enabled,sources:[]};
 if(!enabled||!port)return {state:'FAILED',enabled,sources:[]};
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('RETRIEVAL_TIMEOUT'));},3000);});
  const raw=await Promise.race([port(question,controller.signal),timeout]);
  const valid=raw.filter(s=>typeof s.id==='string'&&s.id.length<=120&&/^https?:\/\//.test(s.url)&&s.url.length<=1000&&s.quote.trim()&&s.quote.length<=1000&&Date.parse(s.fetchedAt)<=now&&Date.parse(s.expiresAt)>=now).slice(0,8);
  return {state:valid.length?(valid.length===raw.length?'SUCCEEDED':'PARTIAL'):'FAILED',enabled,sources:valid};
 }catch{return {state:'FAILED',enabled,sources:[]};}finally{clearTimeout(timer);}
}
export type ActionBinding={requestId:string;owner:string;date:string;target:string;item:string;quantity:string;idempotencyKey:string};
export function actionReceiptMatches(intent:ActionBinding,receipt:ActionBinding&{status:string},currentOwner:string,authorized:boolean){
 return authorized&&currentOwner===intent.owner&&receipt.status==='SUCCEEDED'&&Object.keys(intent).every(k=>intent[k as keyof ActionBinding]===receipt[k as keyof ActionBinding])&&Object.values(intent).every(v=>typeof v==='string'&&v.length>0);
}
