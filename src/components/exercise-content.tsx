import { useState } from 'react';
import { exerciseContent } from '@/lib/strength/exercise-content';
import { FormFigure } from './form-figure';

export function ExerciseContent({catalogId}: {catalogId:string|null}) {
  const content=exerciseContent(catalogId);
  const [large,setLarge]=useState(false);
  const [showFigure,setShowFigure]=useState(false);
  if(!content)return <p className="text-sm text-muted">自定义动作尚无已核对说明。查看不会加入计划或记录完成。</p>;
  return <div className="space-y-4">
    <p className="text-xs text-muted">{content.id} · {content.variant} · {content.groups.join('、')}</p>
    <p className="text-sm">器材：{content.equipment.join('、')} · 难度：{content.difficulty}</p>
    <p className="text-sm text-muted">{content.imageStatus}。文字步骤始终可读。</p>
    {content.imageAvailable&&content.cue ? <><button type="button" className="min-h-11 rounded-xl border border-line px-3 text-sm" onClick={()=>setShowFigure(x=>!x)}>{showFigure?'收起示意':'查看未审校示意'}</button>{showFigure?<><button type="button" className="min-h-11 px-3 text-sm" onClick={()=>setLarge(x=>!x)}>{large?'缩小示意':'放大示意'}</button><div className={large?'grid grid-cols-1 gap-3':'grid grid-cols-2 gap-2'}><FormFigure pose={content.cue.setupPose} caption={`${content.name} · 1 准备（示意）`} /><FormFigure pose={content.cue.effortPose} caption={`${content.name} · 2 发力（示意）`} /></div></>:null}</>:null}
    <section><h3 className="font-bold">动作步骤</h3>{content.steps.length?<ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{content.steps.map((x,i)=><li key={i}>{x}</li>)}</ol>:<p className="mt-2 text-sm text-muted">此变式的动作步骤尚未补齐，不用其他动作的说明代替。</p>}</section>
    {content.cue?<section><h3 className="font-bold">常见错误</h3><p className="mt-2 text-sm">{content.cue.avoid}</p></section>:null}
    <section><h3 className="font-bold">适用与限制</h3><p className="mt-2 text-sm text-muted">{content.applicability}</p><p className="mt-2 text-sm text-muted">替代动作尚未逐项核定，不自动替换课程。</p></section>
    <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer text-sm font-bold">来源与内容状态</summary><p className="mt-2 break-words text-xs text-muted">{content.source?.title??'历史项目提示，尚无逐项文献核验'}{content.source?` · ${content.source.url}`:''}</p><p className="mt-2 text-xs text-muted">{content.provenance.author} · {content.provenance.license} · {content.provenance.redistribution} · {content.provenance.modification} · {content.provenance.version} · {content.provenance.updatedAt} · 未完成专业审校</p></details>
  </div>;
}
