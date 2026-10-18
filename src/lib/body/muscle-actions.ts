import data from '../strength/demo/data.json' with { type: 'json' };
import { FOOT_LIBRARY } from './foot-library';
import { CATALOG } from '@/lib/strength/catalog';
import { has3d } from '@/lib/strength/demo';
export type MusclePick = { k: string; g: string | null } | null;
export type MuscleAction = {
  id: string; name: string; english?: string; source: 'local' | 'foot' | 'external';
  catalogId: string | null; primary: string[]; secondary: string[]; equipment: string[];
  level: string; instructions: string[]; restSec: number | null; unit: 'reps' | 'sec' | 'm' | null;
  sourceUrl: string; media3d: boolean;
};
export const LOCAL_MUSCLE_ACTIONS: MuscleAction[] = [
  ...data.exercises.map(e => ({ id: `local:${e.id}`, name: e.name_zh, english: e.name_en, source: 'local' as const,
    catalogId: e.id, primary: e.primary_muscles, secondary: e.secondary_muscles, equipment: e.equipment,
    level: '难度未评定', instructions: e.cues?.execution ?? [], restSec: e.default_rest_sec,
    unit: (e.default_reps_or_time.mode === 'seconds' ? 'sec' : 'reps') as 'sec' | 'reps', sourceUrl: '', media3d: has3d(e.id) })),
  ...FOOT_LIBRARY.map(e => ({ id: `foot:${e.id}`, name: e.name, source: 'foot' as const, catalogId: null,
    primary: e.muscles, secondary: e.secondary, equipment: [/弹力带/.test(e.name) ? '弹力带' : /毛巾/.test(e.name) ? '毛巾' : '无器械'],
    level: e.level, instructions: e.demo.steps, restSec: e.restSec,
    unit: (e.dose.unit === '秒' ? 'sec' : 'reps') as 'sec' | 'reps', sourceUrl: '', media3d: !!e.demo.motion })),
];
export const EQUIPMENT_ZH: Record<string, string> = { 'body only': '无器械', dumbbell: '哑铃', barbell: '杠铃', cable: '绳索', machine: '器械', kettlebells: '壶铃', bands: '弹力带', 'exercise ball': '健身球', 'medicine ball': '药球', 'e-z curl bar': '曲杆', other: '其他' };
export type ExternalCatalogue = { records: { id: string; name: string; equipment: string | null; level: string | null; muscleKeys: string[]; secondaryKeys: string[]; instructions: string[] }[] };
export function externalActions(catalogue: ExternalCatalogue): MuscleAction[] {
  return catalogue.records.map(e => ({ id: `external:${e.id}`, name: e.name, source: 'external', catalogId: null,
    primary: e.muscleKeys, secondary: e.secondaryKeys, equipment: [e.equipment ? EQUIPMENT_ZH[e.equipment] || e.equipment : '未注明'],
    level: ({ beginner: '入门', intermediate: '中级', expert: '高级' } as Record<string, string>)[e.level || ''] || '未注明',
    instructions: e.instructions, restSec: null, unit: null,
    sourceUrl: `https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/${encodeURIComponent(e.id)}.json`, media3d: false }));
}
export function actionRole(action: MuscleAction, pick: MusclePick) {
  if (!pick) return 'none';
  if (action.primary.some(k => k === pick.k || k === pick.g)) return 'main';
  if (action.secondary.some(k => k === pick.k || k === pick.g)) return 'aux';
  return 'none';
}
export function findMuscleActions(actions: MuscleAction[], pick: MusclePick, query = '', equipment = '', level = '') {
  const q = query.trim().toLowerCase();
  const synonyms: Record<string, string> = { '深蹲': 'squat', '硬拉': 'deadlift', '卧推': 'bench press', '弓步': 'lunge', '提踵': 'calf', '腿弯举': 'leg curl', '俯卧撑': 'pushup', '引体': 'pullup', '哑铃': 'dumbbell', '杠铃': 'barbell', '壶铃': 'kettlebell', '上斜': 'incline', '罗马尼亚': 'romanian', '单腿': 'single leg' };
  const terms = Object.entries(synonyms).filter(([term]) => q.includes(term)).map(([, term]) => term.replace(/[- ]/g, ''));
  return actions.filter(e => {
    const text = `${e.name} ${e.english || ''} ${e.equipment.join(' ')}`.toLowerCase();
    const searchHit = !q || text.includes(q) || (terms.length > 0 && terms.every(term => e.name.toLowerCase().replace(/[- ]/g, '').includes(term)));
    return (!pick || actionRole(e, pick) !== 'none') && searchHit && (!equipment || e.equipment.includes(equipment)) && (!level || e.level === level);
  })
    .sort((a, b) => Number(actionRole(b, pick) === 'main') - Number(actionRole(a, pick) === 'main') || Number(a.source === 'external') - Number(b.source === 'external'));
}
export const knownCatalogId = (action: MuscleAction) => action.catalogId && CATALOG.some(e => e.id === action.catalogId) ? action.catalogId : null;
