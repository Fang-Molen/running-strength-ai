import { CATALOG } from '../strength/catalog'
import data from '../strength/demo/data.json' with { type: 'json' }
import { catalogue as techniques } from '../running-technique/catalogue'

export type FieldworkExercise = {
  id: string; type: 'running' | 'strength'; title: string; en: string; group: string; category: string;
  purpose: string; steps: readonly string[]; cues: readonly string[]; mistakes: readonly string[];
  safety: string; unit: 'm' | 's' | '次'; image: string | null; review: string; contentVersion: string; evidenceLimits: string;
}
// Only image references are taken from the design; all movement content comes from the host catalogues.
import imageRefs from './fieldwork-image-refs.json' with { type: 'json' }
const images = imageRefs as Record<string, string>
export const RUNNING_DRILLS: readonly FieldworkExercise[] = Object.freeze(techniques.drills.map(d => Object.freeze({
  id: d.id, type: 'running' as const, title: d.name_zh, en: d.name_en, group: d.category_name, category: d.category_id,
  purpose: d.primary_purpose, steps: d.steps, cues: d.cues, mistakes: d.common_errors,
  safety: `${d.safety.caution} ${d.safety.stop_rule}${d.safety.requires_supervision ? ' 需要现场教练指导。' : ''}`,
  unit: d.starting_dose.distance_m !== null ? 'm' as const : d.starting_dose.duration_s !== null ? 's' as const : '次' as const,
  image: images[d.id] ?? null, review: d.review_status, contentVersion: d.content_version, evidenceLimits: d.evidence.limits,
})))
export const STRENGTH_DRILLS: readonly FieldworkExercise[] = Object.freeze(CATALOG.map(c => {
  const d = data.exercises.find(row => row.id === c.id)
  if (!d) throw new Error('动作内容映射缺失：' + c.id)
  return Object.freeze({ id: c.id, type: 'strength' as const, title: c.name, en: d.name_en, group: c.group, category: c.group,
    purpose: '学习动作要领与控制；练习是否适用仍需确认。', steps: Object.freeze([...d.cues.setup, ...d.cues.execution]),
    cues: Object.freeze([...d.cues.execution]), mistakes: Object.freeze([...d.cues.mistakes]), safety: d.cues.safety.join(' '),
    unit: c.timed ? 's' as const : '次' as const, image: images[c.id] ?? null,
    review: d.review, contentVersion: data.version, evidenceLimits: '动作和肌群映射待教练组审校；演示不代表医学许可。' })
}))
export function fieldworkExercise(id: string) { return [...RUNNING_DRILLS, ...STRENGTH_DRILLS].find(row => row.id === id) }
