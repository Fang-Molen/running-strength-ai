import { CATALOG, exerciseById } from './catalog';
import { cueFor } from './cues';

export const EXERCISE_CONTENT_VERSION = 'FK-EXERCISE-UI-R1-20261011';
const EQUIPMENT: Record<string, string[]> = {
  goblet:['哑铃或壶铃'], bss:['凳','哑铃'], 'step-up':['稳固台阶'], calf:['稳固台阶'], 'db-rdl':['哑铃'], 'kb-swing':['壶铃'], 'db-row':['哑铃','凳'], farmer:['哑铃或壶铃'], hammer:['哑铃'],
};
const NONE = new Set(['pushup','knee-pushup','diamond-pushup','glute-bridge','single-hip','side-leg','plank','side-plank','knee-plank','dead-bug','crunch','bicycle','russian','situp','vup','climber','burpee']);
const SOURCES: Record<string, {title:string; url:string}> = {
  'knee-pushup': {title:'ACE · Bent Knee Push-up（技术要点核对；未复制图片）',url:'https://www.acefitness.org/resources/everyone/exercise-library/13/bent-knee-push-up/'},
  hammer: {title:'ACE · Hammer Curl（技术要点核对；未复制图片）',url:'https://www.acefitness.org/resources/everyone/exercise-library/10/hammer-curl/'},
};
const WITHHELD = new Set(['db-rdl','kb-swing','single-hip','side-plank']);
export function exerciseContent(id: string | null) {
  const item = id ? exerciseById(id) : null;
  if (!item) return null;
  const cue = cueFor(item.id);
  const newAsset = item.id === 'knee-pushup' || item.id === 'hammer';
  return {
    id:item.id, variant:item.exerciseKey, name:item.name, groups:[item.group], aliases:[] as string[], sport:'力量训练', difficulty: SOURCES[item.id] ? item.id==='hammer'?'中等（ACE）':'入门（ACE）' : '尚未核定',
    equipment:EQUIPMENT[item.id] ?? (NONE.has(item.id)?['无器械']:['器材要求待补全']),
    cue, steps:cue?[cue.setup,cue.effort,'按原路径控制返回；需要继续时重新核对姿势。']:[],
    imageAvailable:!!cue && !WITHHELD.has(item.id), imageStatus:WITHHELD.has(item.id)?'旧图与变式/阶段不匹配，已暂缓展示':cue?'AI 辅助代码示意，未完成专业审校':'缺少分步图',
    applicability:'是否适合本人尚未评估；既往伤病、疼痛或动作不熟练时需先核对限制。',
    alternatives:[] as string[], source:SOURCES[item.id] ?? null,
    provenance:{author:newAsset?'本轮 AI 辅助生成 SVG 代码':'交接包历史 SVG 代码，原作者未核清',license:newAsset?'项目候选源码；无第三方图像素材':'历史许可未核清',redistribution:newAsset?'随候选源码交付；正式发布前审校':'未核定，不作为正式教学素材',modification:newAsset?'源码可编辑':'未核定',version:EXERCISE_CONTENT_VERSION,review:'UNREVIEWED',updatedAt:'2026-10-11'},
  };
}
export function exerciseInventory() { return CATALOG.map(x=>exerciseContent(x.id)!); }
