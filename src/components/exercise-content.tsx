import { exerciseContent } from '@/lib/strength/exercise-content';
import { ExerciseDetailBody } from './exercise-editor';
import { demoData } from '@/lib/strength/demo/provider';
import { useState } from 'react';
import { characterReference, type Gender } from '@/lib/strength/approved-motion';

export function ExerciseContent({catalogId}: {catalogId:string|null}) {
  const [gender,setGender] = useState<Gender>('male');
  const content=exerciseContent(catalogId);
  if (catalogId && demoData.exercises.some(item => item.id === catalogId)) return <ExerciseDetailBody id={catalogId} />;
  if(!content)return <p className="text-sm text-muted">自定义动作尚无已核对说明。查看不会加入计划或记录完成。</p>;
  return <div className="space-y-4">
    <section className="rounded-xl border border-line p-3" aria-label="新版角色形象参考"><div className="mb-2 flex gap-2">{(['male','female'] as const).map(g=><button className="fk-chip" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)} type="button">{g==='male'?'男性':'女性'}</button>)}</div><img src={characterReference(gender)} className="mx-auto h-[220px] w-full object-contain" alt="新版人物外观参考，非本动作示范"/><p className="text-xs text-muted">此形象是设计参考，不代表动作标准姿势。无合格新动画时不显示旧人物。</p></section>
    <p className="text-xs text-muted">{content.id} · {content.variant} · {content.groups.join('、')}</p>
    <p className="text-sm">器材：{content.equipment.join('、')} · 难度：{content.difficulty}</p>
    <p className="text-sm text-muted">{content.imageStatus}。文字步骤始终可读。</p>
    <section><h3 className="font-bold">动作步骤</h3>{content.steps.length?<ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{content.steps.map((x,i)=><li key={i}>{x}</li>)}</ol>:<p className="mt-2 text-sm text-muted">此变式的动作步骤尚未补齐，不用其他动作的说明代替。</p>}</section>
    {content.cue?<section><h3 className="font-bold">常见错误</h3><p className="mt-2 text-sm">{content.cue.avoid}</p></section>:null}
    <section><h3 className="font-bold">适用与限制</h3><p className="mt-2 text-sm text-muted">{content.applicability}</p><p className="mt-2 text-sm text-muted">替代动作尚未逐项核定，不自动替换课程。</p></section>
    <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer text-sm font-bold">来源与内容状态</summary><p className="mt-2 break-words text-xs text-muted">{content.source?.title??'历史项目提示，尚无逐项文献核验'}{content.source?` · ${content.source.url}`:''}</p><p className="mt-2 text-xs text-muted">{content.provenance.author} · {content.provenance.license} · {content.provenance.redistribution} · {content.provenance.modification} · {content.provenance.version} · {content.provenance.updatedAt} · 未完成专业审校</p></details>
  </div>;
}
