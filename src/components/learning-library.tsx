import { useMemo, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, BookOpen, ChevronDown, Search, X } from 'lucide-react';
import { SPORT_CATEGORIES, SPORT_LIBRARY_COUNTS, findSportSource, searchSportKnowledge,
  type SportCategory, type SportDocumentKind } from '@/lib/education/knowledge-catalog';
import { MuscleExplorerSheet } from '@/components/muscle-explorer';
import { CATALOG } from '@/lib/strength/catalog';
import { WarmupDrafts } from '@/components/warmup-drafts';
import { learningQuestion, sportDocumentLabel, sportSourceReadLabel } from '@/lib/education/knowledge-presentation';

/** Read-only learning UI. Search and opening articles never write training data. */
export function LearningLibrary({ onNavigate, onAsk, publicReferencesAllowed = false,
  publicReferencesEnabled = false, online = true, onPublicReferencesChange }: {
  onNavigate?: (tab:'plan'|'body'|'log'|'diet')=>void;
  onAsk?: (question:string)=>void;
  publicReferencesAllowed?:boolean;
  publicReferencesEnabled?:boolean;
  online?:boolean;
  onPublicReferencesChange?: (enabled:boolean)=>void;
}) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState<SportCategory|'all'>('all');
  const [kind,setKind]=useState<SportDocumentKind|'all'>('lesson');
  const [limit,setLimit]=useState(8);
  const [mx,setMx]=useState(false);
  const result=useMemo(()=>searchSportKnowledge({query,category,kind,limit}),[query,category,kind,limit]);
  const setSearch=(next:string)=>{
    if(next.trim()&&!query.trim()){setKind('all');setCategory('all')}
    setQuery(next);setLimit(8);
  };
  const setSection=(next:SportDocumentKind|'all')=>{setKind(next);setLimit(8)};
  const setTopic=(next:SportCategory|'all')=>{setCategory(next);setLimit(8)};
  const resetSearch=()=>{setQuery('');setCategory('all');setKind('all');setLimit(8)};
  const tabs:[SportDocumentKind|'all',string,number][]=[
    ['all','全库',SPORT_LIBRARY_COUNTS.lessons+SPORT_LIBRARY_COUNTS.researchNotes+SPORT_LIBRARY_COUNTS.literature],
    ['lesson','基础课程',SPORT_LIBRARY_COUNTS.lessons],
    ['research-note','研究笔记',SPORT_LIBRARY_COUNTS.researchNotes],
    ['literature','文献索引',SPORT_LIBRARY_COUNTS.literature],
  ];
  const scope=category==='all'?'全部主题':SPORT_CATEGORIES.find(c=>c.id===category)?.label;
  const tabKeys=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    let next=index;
    if(event.key==='ArrowRight')next=(index+1)%tabs.length;
    else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=tabs.length-1;
    else return;
    event.preventDefault();setSection(tabs[next][0]);
    const buttons=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  };
  return <section className="learning-library min-w-0 space-y-3" aria-label="方坤运动知识库">
    <div className="product-section-heading"><div>
      <p className="product-eyebrow">方坤运动知识库</p>
      <h2>训练知识与文献</h2>
    </div><BookOpen size={21} aria-hidden="true" /></div>
    <p className="text-sm text-muted leading-relaxed">查原理、看来源、问方坤。这里的教学资料不等于你的个人训练处方。</p>
    <div className="relative">
      <label className="sr-only" htmlFor="fk-lesson-search">搜索运动知识、文献与关键词</label>
      <Search aria-hidden="true" size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"/>
      <input id="fk-lesson-search" type="search" value={query} onChange={e=>setSearch(e.target.value)}
        maxLength={100} enterKeyHint="search" autoComplete="off"
        placeholder="搜索 800米、深蹲、HRV、午睡…" className="min-h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-12 text-base"/>
      {query?<button type="button" aria-label="清除搜索" onClick={()=>setSearch('')}
        className="absolute right-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-muted"><X size={17}/></button>:null}
    </div>
    <div role="tablist" aria-label="知识内容类型" className="fk-learning-types rounded-xl bg-surface p-1">
      {tabs.map(([id,label,count],index)=><button key={id} type="button" role="tab" aria-selected={kind===id}
        id={`fk-learning-tab-${id}`} aria-controls="fk-learning-results" tabIndex={kind===id?0:-1}
        onKeyDown={e=>tabKeys(e,index)} onClick={()=>setSection(id)}
        className={`min-h-12 min-w-0 rounded-lg px-1 py-2 text-sm ${kind===id?'bg-accent text-accent-fg':'text-muted'}`}>
        <span className="block font-bold">{label}</span><span className="block text-xs opacity-80">{count}{id==='lesson'?'篇':'条'}</span>
      </button>)}
    </div>
    <div role="group" aria-label="按运动主题筛选" className="fk-learning-topics flex gap-2 overflow-x-auto pb-1">
      {[{id:'all' as const,label:'全部'},...SPORT_CATEGORIES.map(c=>({id:c.id,label:c.label}))].map(c=><button key={c.id}
        type="button" aria-pressed={category===c.id} onClick={()=>setTopic(c.id)}
        className={`min-h-11 shrink-0 rounded-full border px-3 text-sm ${category===c.id?'border-accent text-accent':'border-line text-muted'}`}>{c.label}</button>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted">
      <span role="status" aria-live="polite">{scope} · 找到 {result.total} 条</span>
      {query||category!=='all'?<button type="button" className="min-h-11 text-accent" onClick={resetSearch}>清除搜索与筛选</button>:null}
    </div>
    {kind==='research-note'?<p className="rounded-lg border border-line px-3 py-2 text-xs leading-relaxed text-muted">研究笔记待专业审核，仅供查阅，未获处方授权。</p>:null}
    <div id="fk-learning-results" role="tabpanel" aria-labelledby={`fk-learning-tab-${kind}`} tabIndex={0} className="space-y-2">
      {result.items.map(doc=><details key={doc.id} data-knowledge-id={doc.id} className="fk-learning-article home-card min-w-0 p-3">
        <summary className="min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="mb-1 block text-xs font-normal text-muted">{SPORT_CATEGORIES.find(c=>c.id===doc.category)?.label} · {sportDocumentLabel(doc)}</span>
          <span className="flex items-start justify-between gap-2 font-semibold"><span className="min-w-0 flex-1 break-words">{doc.title}</span><ChevronDown size={18} className="fk-learning-chevron shrink-0 text-muted" aria-hidden="true"/></span>
          <span className="mt-1 block text-sm font-normal leading-relaxed text-muted">{doc.summary}</span>
        </summary>
        <div className="fk-learning-reading mt-3 space-y-3 border-t border-line pt-3 text-sm leading-relaxed">
          <div><h3 className="mb-1 font-semibold">{doc.kind==='literature'?'资料概况':'知识讲解'}</h3><p className="whitespace-pre-line">{doc.body}</p></div>
          <div className="rounded-lg bg-surface-2 p-3"><h3 className="mb-1 font-semibold">{doc.kind==='literature'?'查阅建议':'怎样理解或观察'}</h3><p>{doc.practice}</p></div>
          <div><h3 className="mb-1 font-semibold">适用限制</h3><p className="text-muted">{doc.limits}</p></div>
          <details className="fk-learning-sources rounded-lg border border-line px-3">
            <summary className="min-h-11 cursor-pointer content-center font-semibold">来源与核验范围（{doc.sourceIds.length}）</summary>
            <div className="space-y-2 pb-3">
              {doc.sourceIds.map(id=>{
                const source=findSportSource(id);if(!source)return null;
                return <div key={id} className="border-t border-line pt-3 text-xs leading-relaxed">
                  {publicReferencesAllowed?<a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline">{source.title} <ArrowUpRight size={12} className="inline" aria-hidden="true"/><span className="sr-only">（在新窗口打开）</span></a>
                    :<p className="break-words font-medium">{source.title}</p>}
                  <p className="mt-1 text-muted">{source.year} · {source.design}</p>
                  <p className="mt-1 text-muted">核验范围：{sportSourceReadLabel(source.readLevel)}</p>
                  <p className="mt-1 text-muted">来源限制：{source.limits}</p>
                </div>
              })}
              {!publicReferencesAllowed?<p className="text-xs text-muted">{!online?'当前离线，正文和来源信息仍可查阅。':'打开原文前，请在下方「文献阅读设置」中允许打开公开文献。'}</p>:null}
            </div>
          </details>
          {doc.kind==='research-note'?<p className="text-xs text-muted">这条笔记尚待专业审核；应用设想不等于研究原结论。</p>:null}
          {onAsk?<button type="button" className="min-h-11 w-full rounded-xl border border-line px-3 text-left text-sm font-semibold text-accent" onClick={()=>onAsk(learningQuestion(doc))}>问方坤：如何理解这条知识？ ›</button>:null}
        </div>
      </details>)}
      {!result.total?<div className="rounded-xl border border-line p-4 text-sm text-muted" role="status">
        <p className="font-semibold text-fg">没有找到匹配内容</p>
        <p className="mt-1 leading-relaxed">试试较短的关键词，例如「800米」「深蹲」「睡眠」，或清除当前筛选。</p>
        <button type="button" className="mt-2 min-h-11 text-accent" onClick={resetSearch}>查看全库</button>
      </div>:null}
    </div>
    {result.items.length<result.total?<button type="button" className="min-h-12 w-full rounded-xl border border-line px-3 text-sm font-semibold" onClick={()=>setLimit(v=>Math.min(result.total,v+8))}>继续查看（已显示 {result.items.length}/{result.total}）</button>
      :result.total>0?<p className="py-2 text-center text-xs text-muted" role="status">已显示全部 {result.total} 条</p>:null}
    {kind==='lesson'&&category==='strength'&&onNavigate?<button type="button" className="product-text-action min-h-11" onClick={()=>onNavigate('plan')}>查看训练计划 <ArrowUpRight size={16}/></button>:null}
    {kind==='lesson'&&category==='nutrition'&&onNavigate?<button type="button" className="product-text-action min-h-11" onClick={()=>onNavigate('diet')}>查看饮食记录 <ArrowUpRight size={16}/></button>:null}
    <div className="home-card space-y-1 p-3" data-testid="learning-technique">
      <h3 className="font-semibold">动作与热身</h3>
      <p className="text-xs text-muted">现有动作库 {CATALOG.length} 个动作在计划里查看；浏览不会加入课表。</p>
      {onNavigate?<button type="button" className="product-text-action min-h-11" onClick={()=>onNavigate('plan')}>打开动作与课表 <ArrowUpRight size={16}/></button>:null}
      <button type="button" className="product-text-action min-h-11" onClick={()=>setMx(true)}>人体肌群 3D · 足踝小腿动作 <ArrowUpRight size={16}/></button>
      {mx?<MuscleExplorerSheet onClose={()=>setMx(false)}/>:null}
      <WarmupDrafts/>
    </div>
    <details className="fk-learning-settings rounded-xl border border-line px-3 text-xs text-muted">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">文献阅读设置 · {!online?'离线阅读':publicReferencesAllowed?'可打开原文':'本地阅读'}</summary>
      <div className="space-y-2 pb-3 leading-relaxed">
        {onPublicReferencesChange?<label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={publicReferencesEnabled} onChange={event=>onPublicReferencesChange(event.target.checked)} /><span>允许打开公开文献原文</span></label>:null}
        <p>仅在你点击文献链接时打开外部网站，不上传训练或身体记录，也不启用付费模型。知识库正文可在已缓存的页面中离线阅读。</p>
        {!online?<p>网络恢复后，已允许的文献链接会自动恢复。</p>:null}
      </div>
    </details>
  </section>;
}
