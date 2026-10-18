/** Read-only FK-RUN-TECH 1.0 content. These drafts are not approved courses. */
export type RunningEvent = '100' | '200' | '400' | '800' | '1500' | '3000' | '5000' | '10000' | 'half_marathon' | 'marathon'
export type TechniqueCategory = 'posture' | 'coordination' | 'support' | 'acceleration' | 'maxspeed' | 'curve' | 'middle' | 'observation' | 'transfer'
export type DrillLevel = 'beginner' | 'intermediate' | 'advanced'
export type EffortBand = 'low' | 'medium' | 'high'
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T

type StartingDoseData = {
  /** Editorial starting bounds only; never a universal or automatically approved dose. */
  sets: [number, number]
  distance_m: [number, number] | null
  duration_s: [number, number] | null
  reps: [number, number] | null
  rest_s: [number, number]
}

type DrillData = {
  id: string
  schema_version: '1.0.0'
  content_version: string
  kind: 'running_technique'
  name_zh: string
  name_en: string
  category_id: TechniqueCategory
  category_name: string
  skill_level: DrillLevel
  effort_band: EffortBand
  event_tags: RunningEvent[]
  primary_purpose: string
  steps: string[]
  cues: string[]
  common_errors: string[]
  correction_or_regression: string
  starting_dose: StartingDoseData
  dose_note: string
  equipment: string[]
  safety: { caution: string; stop_rule: string; requires_supervision: boolean }
  evidence: { classification: string; limits: string; source_ids: string[] }
  /** No supplied running-technique media is available in this content version. */
  media: { status: 'not_provided'; type: 'none'; url: null; animation_storyboard_id: string | null }
  body_region_roles: { region_key: string; role: 'anatomical_relevance_only' }[]
  muscle_overlay_note: string
  ui_badges: string[]
  review_status: 'draft_needs_coach_review'
}

export type StartingDose = DeepReadonly<StartingDoseData>
export type Drill = DeepReadonly<DrillData>
export type ReadonlyDrillCatalogue = DeepReadonly<{
  schema_version: '1.0.0'
  dataset_version: '1.0.0'
  status: 'curated_draft_requires_coach_review'
  count: number
  categories: Record<TechniqueCategory, string>
  sources: { id: string; name: string; url: string; supports: string }[]
  drills: DrillData[]
}>

export type DrillFilter = Readonly<{
  query?: string
  category?: TechniqueCategory
  event?: RunningEvent
  level?: DrillLevel
  /** Exact equipment label; 'none' selects only entries with no equipment. */
  equipment?: string
}>
