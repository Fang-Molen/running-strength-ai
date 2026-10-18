import {useState} from 'react';
import {preview} from '@/lib/character/identity';
import { Sheet } from './sheet';
import { ExerciseDetailBody } from './exercise-editor';
import { WARMUP_ACTIONS, warmupDose, type WarmupStep } from '@/lib/ui/warmup';
type Stage = { toggle: () => boolean; setSpeed: (s: number) => void; setView: (v: string) => void; destroy: () => void };
function WarmupPlayer({ motion }: { motion: string }) {
  const [gender,setGender]=useState<'male'|'female'>('male');
  return <div className="mt-3 rounded-2xl border border-line p-3" aria-label="热身动作文字教学">
    <div className="flex gap-2" role="group" aria-label="人物选择">{(['male','female'] as const).map(g=><button type="button" className="fk-chip" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)}>{g==='male'?'男性':'女性'}</button>)}</div>
    <img src={preview(gender)} className="mx-auto h-[220px] w-full object-contain" alt="新版角色外观参考，非当前热身动作姿势" />
    <p role="status" className="keep mt-2 text-xs text-muted">{motion}：热身动作的同角色视频还未通过审核，暂显示外观参考与下方技术要点；旧动作播放器已停用。</p>
  </div>
}
export function WarmupDemoSheet({ step, onClose }: { step: WarmupStep; onClose: () => void }) {
  const action = WARMUP_ACTIONS.find(a => a.id === step.actionId);
  return <Sheet full label="热身动作详情" title={step.name} sub={warmupDose(step)} onClose={onClose} footer={<button type="button" className="min-h-12 w-full rounded-xl border border-line font-bold" onClick={onClose}>返回热身</button>}>
    {step.catalogId ? <ExerciseDetailBody id={step.catalogId} /> : action?.motion ? <WarmupPlayer motion={action.motion} /> : <p className="keep text-sm text-muted">此自选主项暂无匹配演示，请核对动作与轻负荷。</p>}
    {action ? <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{action.cues.map(c => <li key={c}>{c}</li>)}</ol> : null}{step.note ? <p className="keep mt-3 text-sm">{step.note}</p> : null}
  </Sheet>;
}
