import { exerciseContent } from '@/lib/strength/exercise-content';
import { ExerciseDetailBody } from './exercise-editor';
import { demoData } from '@/lib/strength/demo/provider';
import { useState } from 'react';
import { poseCardUrl, POSE_CARD_LABEL, defaultPoseGender } from '@/lib/strength/pose-cards-r8';
import { characterReference, type Gender } from '@/lib/strength/approved-motion';

export function ExerciseContent({catalogId}: {catalogId:string|null}) {
  const [gender,setGender] = useState<Gender>(defaultPoseGender);
  const content=exerciseContent(catalogId);
  if (catalogId && demoData.exercises.some(item => item.id === catalogId)) return <ExerciseDetailBody id={catalogId} />;
  if(!content)return <p className="text-sm text-muted">暂无动作说明。</p>;
  return <div className="space-y-4">
    <section className="rounded-xl border border-line p-3" aria-label="动作图示"><div className="mb-2 flex gap-2">{(['male','female'] as const).map(g=><button className="fk-chip" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)} type="button">{g==='male'?'男性':'女性'}</button>)}</div>{poseCardUrl(catalogId, gender)?<><img data-testid="pose-card" src={poseCardUrl(catalogId, gender)!} loading="lazy" decoding="async" className="mx-auto max-h-[420px] w-full object-contain" alt="姿势示意（待审核）"/><p className="text-sm font-semibold text-amber-500">{POSE_CARD_LABEL}</p></>:<><img src={characterReference(gender)} className="mx-auto h-[220px] w-full object-contain" alt="角色参考，非本动作示范"/><p className="text-sm text-muted">角色参考</p></>}</section>
    <p className="text-sm">相关部位：{content.groups.join('、')}</p>
    <p className="text-sm">器材：{content.equipment.join('、')}</p>
    <section><h3 className="font-bold">动作步骤</h3>{content.steps.length?<ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{content.steps.map((x,i)=><li key={i}>{x}</li>)}</ol>:<p className="mt-2 text-sm text-muted">暂无动作步骤。</p>}</section>
    {content.cue?<section><h3 className="font-bold">常见错误</h3><p className="mt-2 text-sm">{content.cue.avoid}</p></section>:null}
    <section><h3 className="font-bold">注意事项</h3><p className="mt-2 text-sm">{content.applicability}</p></section>
  </div>;
}
