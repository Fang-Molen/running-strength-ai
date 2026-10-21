import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, ChevronDown, Search, X } from 'lucide-react';
import { SPORT_CATEGORIES, findSportSource, searchSportKnowledge,
  type SportCategory, type SportDocumentKind } from '@/lib/education/knowledge-catalog';
import { MuscleExplorerSheet } from '@/components/muscle-explorer';
import { CATALOG } from '@/lib/strength/catalog';
import { WarmupDrafts } from '@/components/warmup-drafts';
import { learningQuestion, sportDocumentLabel, sportSourceReadLabel } from '@/lib/education/knowledge-presentation';
import { athleteReading } from '@/lib/education/knowledge-reader';

const TOPICS:Record<SportCategory,string>={track:'跑步',strength:'力量',recovery:'恢复',nutrition:'饮食',principles:'训练安排',technique:'动作与热身'};
/** Read-only learning. Draft research is kept in an explicit reference mode. */
export function LearningLibrary({ onNavigate, onAsk, publicReferencesAllowed = false,
  publicReferencesEnabled = false, online = true, active = true, onPublicReferencesChange }: {
  onNavigate?: (tab:'plan'|'body'|'log'|'diet')=>void;
  onAsk?: (question:string)=>void;
  publicReferencesAllowed?:boolean; publicReferencesEnabled?:boolean; online?:boolean; active?:boolean;
  onPublicReferencesChange?: (enabled:boolean)=>void;
}) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<SportCategory|'all'>('all');
  const [mode,setMode]=useState<'reading'|'references'>('reading');
  const [referenceKind,setReferenceKind]=useState<SportDocumentKind|'all'>('research-note');
  const [limit,setLimit]=useState(8),[mx,setMx]=useState(false);
  const technique=useRef<HTMLDivElement>(null);
  const kind=mode==='reading'?'lesson':referenceKind;
  const result=useMemo(()=>searchSportKnowledge({query,category,kind,limit}),[query,category,kind,limit]);
  const additional=useMemo(()=>query.trim()?searchSportKnowledge({query,category,kind:'all',limit:1000}).items.filter(d=>d.kind!=='lesson').length:0,[query,category]);
  const setSearch=(next:string)=>{if(next.trim()&&!query.trim())setCategory('all');setQuery(next);setLimit(8)};
  const switchMode=(next:typeof mode)=>{setMode(next);setLimit(8)};
  const reset=()=>{setQuery('');setCategory('all');setLimit(8)};
  const tabKeys=(e:KeyboardEvent<HTMLButtonElement>)=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;
    e.preventDefault();const next=e.key==='Home'?'reading':e.key==='End'?'references':mode==='reading'?'references':'reading';switchMode(next);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next==='reading'?0:1]?.focus();
  };
  return <section className="learning-library min-w-0 space-y-3" aria-label="方坤运动知识库">
    <div className="fk-reader-heading"><h2>运动知识</h2><button type="button" onClick={()=>{technique.current?.scrollIntoView({block:'start',behavior:'instant'});technique.current?.focus({preventScroll:true})}}>动作与热身 ↗</button></div>
    <div className="relative">
      <label className="sr-only" htmlFor="fk-lesson-search">搜索运动知识、文献与关键词</label>
      <Search aria-hidden="true" size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"/>
      <input id="fk-lesson-search" type="search" value={query} onChange={e=>setSearch(e.target.value)} maxLength={100} enterKeyHint="search" autoComplete="off"
        placeholder="想了解什么？如热身、增肌、HRV" className="min-h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-12 text-base"/>
      {query?<button type="button" aria-label="清除搜索" onClick={()=>setSearch('')} className="absolute right-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-muted"><X size={17}/></button>:null}
    </div>
    <div role="tablist" aria-label="知识阅读方式" className="fk-reader-modes">
      {([['reading','读知识'],['references','查资料']] as const).map(([id,label])=><button key={id} role="tab" type="button" id={`fk-reader-${id}`} aria-selected={mode===id} aria-controls="fk-learning-results" tabIndex={mode===id?0:-1} onKeyDown={tabKeys} onClick={()=>switchMode(id)}>{label}</button>)}
    </div>
    <div role="group" aria-label="按运动主题筛选" className="fk-learning-topics flex gap-2 overflow-x-auto pb-1">
      {[{id:'all' as const,label:'全部'},...SPORT_CATEGORIES.map(c=>({id:c.id,label:TOPICS[c.id]}))].map(c=><button key={c.id} type="button" aria-pressed={category===c.id} onClick={()=>{setCategory(c.id);setLimit(8)}} className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${category===c.id?'border-accent text-accent':'border-line text-muted'}`}>{c.label}</button>)}
    </div>
    {mode==='references'?<div className="fk-reader-reference-filter"><label>资料类型<select aria-label="资料类型" value={referenceKind} onChange={e=>{setReferenceKind(e.target.value as SportDocumentKind|'all');setLimit(8)}}><option value="research-note">研究草稿</option><option value="literature">参考文献</option><option value="all">全部内容</option></select></label><p>研究草稿待专业审核，不作为个人训练建议。</p></div>:null}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span role="status" aria-live="polite">{query?'找到':'共'} {result.total} {mode==='reading'?'篇知识':'条资料'}</span>
      {query||category!=='all'?<button type="button" className="min-h-11 text-accent" onClick={reset}>重置筛选</button>:null}
    </div>
    {mode==='reading'&&additional>0?<button type="button" className="fk-reader-more-references" onClick={()=>{setReferenceKind('all');switchMode('references')}}>还找到 {additional} 条研究与来源，去查资料 ›</button>:null}
    <div id="fk-learning-results" role="tabpanel" aria-labelledby={`fk-reader-${mode}`} tabIndex={0} className="space-y-2">
      {result.items.map(doc=>{const r=athleteReading(doc);return <details key={doc.id} name="fk-learning-article" data-knowledge-id={doc.id} className="fk-learning-article home-card min-w-0 p-4">
        <summary className="min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          {doc.kind!=='lesson'?<span className="mb-1 block text-xs text-muted">{sportDocumentLabel(doc)}</span>:null}
          <span className="flex items-start justify-between gap-2 font-semibold"><span className="min-w-0 flex-1 break-words">{r.title}</span><ChevronDown size={18} className="fk-learning-chevron shrink-0 text-muted" aria-hidden="true"/></span>
          <span className="fk-reader-conclusion mt-2 block text-sm font-normal text-muted">{r.summary}</span>
        </summary>
        <div className="fk-learning-reading mt-3 space-y-3 border-t border-line pt-3 text-sm">
          <ul className="fk-reader-points" data-testid="reading-points">{r.points.map((point,i)=><li key={i}>{point}</li>)}</ul>
          <div className="fk-reader-practice"><h3>{doc.kind==='lesson'?'平时怎么用':'查阅提示'}</h3><p>{r.practice}</p></div>
          <p className="keep text-xs leading-relaxed text-muted" data-testid="reading-note">{r.note}</p>
          {onAsk?<button type="button" className="fk-reader-ask" onClick={()=>onAsk(learningQuestion(doc))}>让方坤讲简单点 ›</button>:null}
          <details className="fk-learning-sources border-t border-line">
            <summary className="min-h-11 cursor-pointer content-center text-xs text-muted">详细说明与来源</summary>
            <div className="space-y-3 pb-3 text-xs leading-relaxed">
              <p>{doc.body}</p><p>适用范围：{doc.limits}</p>
              {doc.sourceIds.map(id=>{const source=findSportSource(id);if(!source)return null;return <div key={id} className="border-t border-line pt-3">
                {publicReferencesAllowed?<a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline">{source.title} <ArrowUpRight size={12} className="inline" aria-hidden="true"/><span className="sr-only">（在新窗口打开）</span></a>:<p className="break-words font-medium">{source.title}</p>}
                <p className="mt-1 text-muted">{source.year} · {source.design}</p><p className="mt-1 text-muted">{sportSourceReadLabel(source.readLevel)}</p><p className="mt-1 text-muted">{source.limits}</p>
              </div>})}
              {!publicReferencesAllowed?<p className="text-muted">{!online?'当前离线，仍可阅读已保存的内容。':'要打开原文，请在下方「文献阅读设置」中允许外部链接。'}</p>:null}
            </div>
          </details>
        </div>
      </details>})}
      {!result.total?<div className="rounded-xl border border-line p-4 text-sm text-muted" role="status"><p>没找到，试试“热身”“睡眠”等短词。</p><button type="button" className="mt-2 min-h-11 text-accent" onClick={reset}>查看全部</button></div>:null}
    </div>
    {result.items.length<result.total?<button type="button" className="min-h-12 w-full rounded-xl border border-line px-3 text-sm" onClick={()=>setLimit(v=>Math.min(result.total,v+8))}>再看一些（{result.items.length}/{result.total}）</button>:result.total>0?<p className="keep py-2 text-center text-xs text-muted">已显示全部 {result.total} 条</p>:null}
    {mode==='reading'&&category==='strength'&&onNavigate?<button type="button" className="product-text-action min-h-11" onClick={()=>onNavigate('plan')}>查看训练计划 <ArrowUpRight size={16}/></button>:null}
    {mode==='reading'&&category==='nutrition'&&onNavigate?<button type="button" className="product-text-action min-h-11" onClick={()=>onNavigate('diet')}>查看饮食记录 <ArrowUpRight size={16}/></button>:null}
    <div ref={technique} tabIndex={-1} className="home-card scroll-mt-4 space-y-1 p-3" data-testid="learning-technique">
      <h3 className="font-semibold">动作与热身</h3><p className="keep text-xs text-muted">{CATALOG.length} 个动作，先看懂，再安排训练。</p>
      {onNavigate?<button type="button" className="product-text-action min-h-11" onClick={()=>onNavigate('plan')}>打开动作与课表 <ArrowUpRight size={16}/></button>:null}
      <button type="button" className="product-text-action min-h-11" onClick={()=>setMx(true)}>人体肌群 3D · 足踝小腿动作 <ArrowUpRight size={16}/></button>
      {mx&&active?<MuscleExplorerSheet onClose={()=>setMx(false)}/>:null}<WarmupDrafts active={active&&!mx}/>
    </div>
    <details className="fk-learning-settings rounded-xl border border-line px-3 text-xs text-muted">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">文献阅读设置 · {!online?'离线阅读':publicReferencesAllowed?'可打开原文':'本地阅读'}</summary>
      <div className="space-y-2 pb-3 leading-relaxed">
        {onPublicReferencesChange?<label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={publicReferencesEnabled} onChange={e=>onPublicReferencesChange(e.target.checked)}/><span>允许打开公开文献原文</span></label>:null}
        <p>只在点击时打开外部网站，不上传你的训练记录，也不调用付费模型。</p>
      </div>
    </details>
  </section>;
}
