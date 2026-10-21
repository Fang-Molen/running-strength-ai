/** V93 user-facing sports knowledge discovery. Read-only: NEVER returns personal prescriptions.
 * Do not import the AI-reasoning methods (S13–S16) into the athlete education library.
 */
import rawArticles from './learning-articles.json' with { type: 'json' };
import rawCards from '../../../knowledge/coach-complete-20261020/knowledge_cards.json' with { type: 'json' };
import rawSources from '../../../knowledge/coach-complete-20261020/sources.json' with { type: 'json' };
import modernSources from './modern-sports-sources.json' with { type: 'json' };
import { readerSearchText } from './knowledge-reader.ts';
import { COACH_KNOWLEDGE } from '../core/coach-knowledge.ts';
import { RESEARCH_SEED } from '../core/research-knowledge-registry.ts';

export const SPORT_CATEGORIES = [
  { id:'track', label:'田径专项', description:'短跑、中跑、配速和间歇' },
  { id:'strength', label:'力量与肌肉', description:'动作、组次与专项迁移' },
  { id:'recovery', label:'恢复与伤病', description:'睡眠、HRV、疼痛和恢复' },
  { id:'nutrition', label:'运动营养', description:'能量、蛋白质、补水' },
  { id:'principles', label:'训练原理', description:'周期、负荷与测量' },
  { id:'technique', label:'动作技术', description:'跑姿、热身和动作质量' },
] as const;
export type SportCategory = typeof SPORT_CATEGORIES[number]['id'];
export type SportDocumentKind = 'lesson'|'research-note'|'literature';
export type SportDocument = Readonly<{
  id:string;kind:SportDocumentKind;category:SportCategory;title:string;summary:string;
  body:string;practice:string;limits:string;sourceIds:readonly string[];
  reviewStatus:'EDUCATIONAL_DRAFT'|'RESEARCH_PENDING'|'SOURCE_INDEX';
  personalPrescription:false;
}>;
export type SportSource = Readonly<{
  id:string;title:string;url:string;year:string;design:string;readLevel:string;summary:string;limits:string;
  provenance:'EXISTING_KNOWLEDGE_CATALOG'|'PREVIOUS_CURATED_CARD'|'INHERITED_R3'|'VERIFIED_PUBLIC_SUMMARY';
}>;

const READ_LEVEL_LABELS: Readonly<Record<string, string>> = {
  ABSTRACT_READ: '已核对公开摘要',
  ABSTRACT_READ_PRIOR_TURN: '此前已核对摘要，本轮未重新核对',
  SECTION_READ: '已核对相关章节，未通读全文',
  RELEVANT_FULLTEXT_SECTIONS_READ: '已核对全文中的相关章节',
  AUTHOR_ABSTRACT_INDEXED_EXCERPTS_READ: '已核对作者摘要及收录片段',
  ABSTRACT_AND_KEY_POINTS_READ: '已核对摘要与关键要点',
  PUBLISHER_INDEXED_EXCERPTS_READ: '已核对出版方收录片段，未通读全文',
  PUBLIC_ABSTRACT_OR_RELEVANT_TEXT_2026_10_21: '2026年10月21日核对公开摘要或相关章节',
  PREVIOUSLY_CURATED_NOT_REVERIFIED: '沿用此前整理的来源，本轮未重新核对',
  INHERITED_FULLTEXT_MARK_NOT_REVERIFIED: '历史记录标注已读全文，本轮未重新核对',
};

export function sportSourceReadLabel(level: string): string {
  return READ_LEVEL_LABELS[level] ?? '核验范围待补充';
}


const domainCategory:Record<string,SportCategory>={
  PROGRAMMING:'principles', RUNNING:'track', STRENGTH:'strength', RECOVERY:'recovery',
  MEASUREMENT:'principles', NUTRITION:'nutrition',
};
const sportsSourceIds = new Set(rawSources.filter(s=>/^S(0[1-9]|1[0-2])$/.test(s.id)).map(s=>s.id));
const safeUrl=(url:string)=>/^https:\/\//i.test(url)&&!/[\s<>"']/.test(url);
const sourceIndex:SportSource[]=rawSources.filter(s=>sportsSourceIds.has(s.id)&&safeUrl(s.url)).map(s=>({
  id:s.id,title:s.title,url:s.url,year:String(s.year),design:s.type,readLevel:s.read_level,
  summary:s.verified_summary,limits:s.limits,provenance:'EXISTING_KNOWLEDGE_CATALOG',
}));
for(const item of modernSources){
  if(!safeUrl(item.url)||sourceIndex.some(s=>s.id===item.id))continue;
  sourceIndex.push({...item,provenance:'VERIFIED_PUBLIC_SUMMARY'});
}
for(const card of COACH_KNOWLEDGE){
  const id=`COACH:${card.id}`;
  if(!safeUrl(card.url)||sourceIndex.some(s=>s.url===card.url))continue;
  sourceIndex.push({id,title:card.sourceTitle,url:card.url,year:card.reviewedAt.slice(0,4),
    design:'既有教练一般知识来源',readLevel:'PREVIOUSLY_CURATED_NOT_REVERIFIED',
    summary:card.principle,limits:card.limit,provenance:'PREVIOUS_CURATED_CARD'});
}
for(const card of RESEARCH_SEED){
  if(!card.url||!safeUrl(card.url)||sourceIndex.some(s=>s.url===card.url))continue;
  sourceIndex.push({id:`R3:${card.id}`,title:card.title,url:card.url,year:card.reviewedAt?.slice(0,4)??'未知',
    design:card.studyDesign,readLevel:'INHERITED_FULLTEXT_MARK_NOT_REVERIFIED',
    summary:card.result,limits:card.limitations+'；'+card.transferBoundary,provenance:'INHERITED_R3'});
}
export const SPORT_SOURCES:readonly SportSource[]=Object.freeze(sourceIndex);
const knownSourceIds=new Set(SPORT_SOURCES.map(s=>s.id));
const lessons:SportDocument[]=rawArticles.filter(a=>a.sourceIds.length&&a.sourceIds.every(s=>knownSourceIds.has(s)))
  .map(a=>({id:a.id,kind:'lesson',category:a.category as SportCategory,title:a.title,summary:a.summary,
    body:a.body,practice:a.practice,limits:a.limits,sourceIds:a.sourceIds,
    reviewStatus:'EDUCATIONAL_DRAFT',personalPrescription:false}));
// Candidate knowledge remains visible as RESEARCH PREVIEW ONLY. Never turn it into approved clinical/training advice.
const researchNotes:SportDocument[]=rawCards.filter(c=>
  domainCategory[c.domain]&&c.professional_review==='PENDING'&&!c.production_eligible&&
  c.source_ids.length>0&&c.source_ids.every(s=>sportsSourceIds.has(s)&&knownSourceIds.has(s))
).map(c=>({id:`RESEARCH:${c.id}`,kind:'research-note',category:domainCategory[c.domain],title:c.title,
  summary:c.proposed_application,body:c.proposed_application,
  practice:c.smallest_useful_question,limits:c.not_supported,sourceIds:c.source_ids,
  reviewStatus:'RESEARCH_PENDING',personalPrescription:false}));
const categoryForSource=(s:SportSource):SportCategory=>{
  if(/nutrition|protein|energy|diet|营养|RED/i.test(s.title))return 'nutrition';
  if(/sleep|psychology|mental health|autonomic|athlete training response|睡眠|心理/i.test(s.title))return 'recovery';
  if(/strength|resistance|skeletal|ACSM|肌肉/i.test(s.title))return 'strength';
  if(/sprint|800|1500|coordination|短跑/i.test(s.title))return 'track';
  return 'principles';
};
const literature:SportDocument[]=SPORT_SOURCES.filter(s=>!SPORT_SOURCES.some(other=>other!==s&&other.url.toLowerCase()===s.url.toLowerCase()&&other.provenance==='VERIFIED_PUBLIC_SUMMARY')).map(s=>({
  id:`SOURCE:${s.id}`,kind:'literature',category:categoryForSource(s),title:s.title,
  summary:s.summary,body:`研究类型：${s.design}；资料核验范围：${sportSourceReadLabel(s.readLevel)}。`,practice:'查看来源原文，并核对研究人群与适用范围。',
  limits:s.limits,sourceIds:[s.id],reviewStatus:'SOURCE_INDEX',personalPrescription:false,
}));
export const SPORT_DOCUMENTS:readonly SportDocument[]=Object.freeze([...lessons,...researchNotes,...literature]);
export const SPORT_LIBRARY_COUNTS=Object.freeze({
  lessons:lessons.length,researchNotes:researchNotes.length,literature:literature.length,sources:SPORT_SOURCES.length,
});
export const findSportSource=(id:string)=>SPORT_SOURCES.find(s=>s.id===id);
const synonyms:Record<string,readonly string[]>={
  '800米':['800','中跑','专项','配速'], '1500米':['1500','中跑','配速'],
  '400米':['400','短跑','分段'], '肌肉':['肌群','力量','酸痛'],
  '佳明':['设备','心率','手表'], '高驰':['设备','心率','手表'],
  'HRV':['心率变异','恢复','hrv'], '午睡':['睡眠','休息'],
  '422':['简写','间歇','组次'], '1234321':['简写','间歇','组次'],
};
function tokens(query:string){
  const q=query.normalize('NFKC').trim().toLowerCase().slice(0,100);
  if(!q)return [];
  const terms=q.split(/[\s,，、;；]+/).filter(Boolean);
  const expanded=new Set(terms);
  for(const term of terms)for(const [key,values] of Object.entries(synonyms)){
    if(key.toLowerCase()===term)values.forEach(v=>expanded.add(v.toLowerCase()));
  }
  return [...expanded];
}
export function searchSportKnowledge(options:{query?:string;category?:SportCategory|'all';kind?:SportDocumentKind|'all';limit?:number;offset?:number}={}){
  const {query='',category='all',kind='lesson',limit=12,offset=0}=options;
  // The UI progressively requests more items from offset 0. Cap at the actual
  // catalogue size, otherwise a fixed 60-item cap makes "continue" stall forever.
  const words=tokens(query), max=Math.max(1,Math.min(SPORT_DOCUMENTS.length,Number.isFinite(limit)?Math.floor(limit):12));
  const skip=Math.max(0,Number.isFinite(offset)?Math.floor(offset):0);
  const ranked=SPORT_DOCUMENTS.filter(doc=>(category==='all'||doc.category===category)&&(kind==='all'||doc.kind===kind)).map(doc=>{
    const sources=doc.sourceIds.map(findSportSource).filter((s):s is SportSource=>!!s);
    const title=doc.title.toLowerCase(), all=[doc.title,doc.summary,doc.body,doc.practice,doc.limits,readerSearchText(doc),
      ...sources.map(s=>s.title+' '+s.summary+' '+s.design+' '+s.id)].join(' ').normalize('NFKC').toLowerCase();
    const score=words.reduce((acc,word)=>acc+(title.includes(word)?10:all.includes(word)?2:0),0);
    return {doc,score};
  }).filter(x=>!words.length||x.score>0).sort((a,b)=>b.score-a.score||a.doc.id.localeCompare(b.doc.id));
  return {total:ranked.length,items:ranked.slice(skip,skip+max).map(x=>x.doc)};
}
