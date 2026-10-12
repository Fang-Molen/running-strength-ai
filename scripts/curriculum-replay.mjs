import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.cwd(), output=process.argv[2]??'curriculum-answers.json';
const get=p=>import(pathToFileURL(root+'/'+p).href);
const {assembleCoachBrief}=await get('src/lib/core/coach-brief.ts');
const {answerLocally}=await get('src/lib/core/coach-local-first.ts');
const {setStoreBackend}=await get('src/lib/core/storage.ts');
const inputs=JSON.parse(readFileSync(root+'/evaluation/curriculum-r1/integration-inputs.json','utf8'));
let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw new Error('NETWORK_DISABLED')};
const out=[];
for(const i of inputs){
 const data=new Map();const store={keys:()=>[...data.keys()],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 setStoreBackend(store);const before=JSON.stringify([...data]);
 const brief=assembleCoachBrief(null,i.question,null); const answer=answerLocally(brief);
 out.push({...i,answer,networkAttempts,storageUnchanged:JSON.stringify([...data])===before,answerSHA256:createHash('sha256').update(answer.text).digest('hex'),entry:'assembleCoachBrief(null, question, null) → answerLocally(brief)',browserVerified:false});
 console.log(i.id,answer.sources.join(','),answer.text.slice(0,100).replace(/\n/g,' '));
}
setStoreBackend(null);writeFileSync(output,JSON.stringify(out,null,2));
