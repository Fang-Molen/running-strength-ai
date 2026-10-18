import MiniSearch from 'minisearch'
import { PLAYBOOK_CONCEPTS } from './coach-playbook-concepts.ts'
import { normalizeCoachText, ageFromText, temperatureFromText, energyIntakeFromText, detectRedFlags } from './coach-red-flags.ts'
/** Character bigrams avoid imposing English token boundaries on Chinese. */
export function retrievalTokens(text:string):string[]{
 const q=normalizeCoachText(text);const words=q.match(/[a-z]+(?:-[a-z]+)?|\d+(?:\.\d+)?|[\p{Script=Han}]+/gu)??[]
 return words.flatMap(w=>/^[\p{Script=Han}]+$/u.test(w)?w.length===1?[w]:Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)):[w])
}
export function normalizeRetrievalQuery(text:string):string{
 return normalizeCoachText(text).replace(/千米|公里/g,'km').replace(/公斤|千克/g,'kg').replace(/四分半/g,'4:30/km').replace(/半马/g,'21.1km')
}
type Document={id:string;title:string;question:string;guidance:string;terms:string[]}
let index:MiniSearch|null=null,indexKey=''
export function rankPlaybook(question:string,documents:readonly Document[]):{id:string;score:number}[]{
 const key=documents.map(x=>x.id).join('|')
 if(!index||indexKey!==key){index=new MiniSearch({fields:['title','question','guidance','concepts'],storeFields:['id'],tokenize:retrievalTokens,searchOptions:{boost:{title:2,question:2},combineWith:'OR'}})
  index.addAll(documents.map(d=>({...d,concepts:(PLAYBOOK_CONCEPTS[d.id]??[]).flatMap(c=>c.synonyms).join(' ')})));indexKey=key}
 const q=normalizeRetrievalQuery(question),bm25=new Map(index.search(q).map(r=>[r.id as string,r.score]))
 const red=detectRedFlags(question),forced:Record<string,string>={HEAT:'PB-HEAT',CARDIOVASCULAR:'PB-HEART',SYNCOPE:'PB-HEART',NEUROLOGICAL:'PB-PAIN',RESPIRATORY:'PB-ILLNESS',ENERGY:'PB-ENERGY',YOUTH:'PB-YOUTH',POST_ILLNESS:'PB-ILLNESS',PAIN:'PB-PAIN'}
 const forces=new Set(red.classes.filter(c=>red.level!=='NONE'||c==='YOUTH').map(c=>forced[c]).filter(Boolean))
 const age=ageFromText(q),temp=temperatureFromText(q),kcal=energyIntakeFromText(q)
 const numeric:Record<string,number>={
  'PB-HEAT':temp!==null&&temp>=28?10:0,'PB-YOUTH':age!==null&&age<18?10:0,
  'PB-ENERGY':kcal!==null&&kcal<1800||/只吃.{0,3}顿|一天.{0,3}顿/.test(q)?10:0,
  'PB-LOAD':/(?:周|月|跑量|里程).{0,16}(?:%|百分之|\d+km)|(?:多跑|增加|增幅).{0,6}\d+%/.test(q)?8:0,
  'PB-GPS':/\d+圈|第\d+道/.test(q)?8:0,
  'PB-HEART':/(?:静息|晨脉|晨起).{0,12}(?:\d+|增加|高|低)/.test(q)?8:0,
  'PB-STRENGTH':/\d+(?:kg|次)|rir\s*\d/.test(q)?8:0}
 return documents.map(d=>({id:d.id,score:(forces.has(d.id)?30:0)+(numeric[d.id]??0)+
  (PLAYBOOK_CONCEPTS[d.id]??[]).reduce((sum,c)=>sum+(c.synonyms.some(w=>q.includes(normalizeRetrievalQuery(w)))?c.weight:0),0)+
  d.terms.reduce((sum,t)=>sum+(q.includes(t.toLowerCase())?['手表','疲劳','课后','同一天','最后一组'].includes(t)?.3:1:0),0)+
  Math.min(6,(bm25.get(d.id)??0)*.25)+(q===normalizeRetrievalQuery(d.question)?8:0)}))
 .filter(r=>r.score>1).sort((a,b)=>b.score-a.score)
}
