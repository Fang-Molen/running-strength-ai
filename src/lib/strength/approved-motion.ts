import { preview } from '../character/identity.ts'
import {allowedMotionCharacter} from '../body/character-selection.ts'
/** Only independently reviewed, same-origin, new-character motions are eligible to play.
 * Do NOT use legacy MOTION_KEYS / athlete.glb as a fallback.
 */
export type Gender = 'male' | 'female'
export type View = 'front' | 'side' | 'back' | 'three'
export const APPROVALS = [
  'license', 'character_appearance', 'skinning', 'motion_biomechanics',
  'equipment_contact', 'mobile_webgl'
] as const
export interface ApprovedMotion {
  exercise_id: string
  character_id: string
  asset_version: string
  rig_version: string
  character_sha256: string
  gender: Gender
  uri: string
  sha256: string
  status: 'APPROVED'
  clip_name: string
  reviews: Record<(typeof APPROVALS)[number], 'PASS'>
  reviewed_by: string
  evidence_path: string
}
export interface ApprovedMotionManifest { schema: 'fangkun-approved-motion-v1'; assets: ApprovedMotion[] }
const ID = /^[a-z0-9][a-z0-9_-]{1,95}$/
const SHA = /^[a-f0-9]{64}$/
const URI = /^\/fangkun-motion\/assets\/[a-zA-Z0-9_-]+\.glb$/
const EVIDENCE = /^docs\/qa\/[a-zA-Z0-9_./-]+\.json$/
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

export function validateMotionEntry(value: unknown): value is ApprovedMotion {
  if (!isObj(value)) return false
  const { exercise_id, gender, uri, sha256, status, reviews, reviewed_by, evidence_path, clip_name } = value
  return typeof exercise_id === 'string' && ID.test(exercise_id) &&
    (gender==='male'||gender==='female') && allowedMotionCharacter(gender,value.character_id) &&
    typeof value.asset_version === 'string' && ID.test(value.asset_version) &&
    typeof value.rig_version === 'string' && ID.test(value.rig_version) &&
    typeof value.character_sha256 === 'string' && SHA.test(value.character_sha256) &&
    (gender === 'female' || gender === 'male') &&
    typeof uri === 'string' && URI.test(uri) && !uri.includes('..') &&
    typeof sha256 === 'string' && SHA.test(sha256) && status === 'APPROVED' &&
    typeof clip_name === 'string' && clip_name.length > 1 && clip_name.length < 90 &&
    isObj(reviews) && APPROVALS.every(key => reviews[key] === 'PASS') &&
    typeof reviewed_by === 'string' && reviewed_by.trim().length >= 2 && !/REPLACE|TODO|TBD/i.test(reviewed_by) &&
    typeof evidence_path === 'string' && EVIDENCE.test(evidence_path) && !evidence_path.includes('..')
}

/** Fail closed for any malformed asset, even if a separate asset appears valid. */
export function validateMotionManifest(value: unknown): value is ApprovedMotionManifest {
  if (!isObj(value) || value.schema !== 'fangkun-approved-motion-v1' || !Array.isArray(value.assets)) return false
  const keys = new Set<string>()
  for (const item of value.assets) {
    if (!validateMotionEntry(item)) return false
    const key = `${item.gender}:${item.exercise_id}`
    if (keys.has(key)) return false
    keys.add(key)
  }
  return true
}

export function findApprovedMotion(manifest: unknown, exerciseId: string, gender: Gender): ApprovedMotion | null {
  if (!validateMotionManifest(manifest) || !ID.test(exerciseId)) return null
  return manifest.assets.find(item => item.exercise_id === exerciseId && item.gender === gender) ?? null
}

export async function loadApprovedMotion(exerciseId: string, gender: Gender, signal?: AbortSignal): Promise<ApprovedMotion | null> {
  // No cached approval: new manifest can revoke a defective asset without an app redeploy.
  const response = await fetch('/fangkun-motion/manifest.json', { signal, cache: 'no-store' })
  if (!response.ok || /text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('动作审核清单不可用')
  const json: unknown = await response.json()
  if (!validateMotionManifest(json)) throw new Error('动作审核清单格式无效，已停止3D展示')
  return findApprovedMotion(json, exerciseId, gender)
}

/** Static approved design reference only. It is NOT the requested exercise pose. */
export function characterReference(gender: Gender, view: 'front' | 'turnaround' = 'front'): string {
  return view === 'turnaround' ? `/fangkun-character/${gender}-turnaround.webp` : preview(gender)
}
