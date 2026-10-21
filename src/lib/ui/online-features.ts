/** v78（用户 t473：“所有软件上需要联网的都给我联网”）：所有联网功能默认开启，同意只记录一次，设置里可逐项关闭。
 * 只决定“是否联网”，不改各功能发送的内容：识字整理/估算只发文字，不发图片；方坤联网只发去标识化事实。密钥都在服务端。 */
import { currentStore } from '../core/storage'
import { COACH_ONLINE_KEY, ONLINE_FEATURES_KEY, savedOnlineChoices, savedOnlineRecord } from './online-preferences'
export { ONLINE_FEATURES_KEY } from './online-preferences'
import { COACH_NETWORK_MODE_KEY } from '../core/coach-network-policy'
export type OnlineFeature = 'coach' | 'coachRefs' | 'ocrText' | 'foodEstimate'
export const ONLINE_FEATURES: { id: OnlineFeature; title: string; sends: string }[] = [
  { id: 'coach', title: '方坤联网分析', sends: '问题、最近几轮对话、去标识化训练与恢复数值 → DeepSeek' },
  { id: 'coachRefs', title: '方坤公开资料', sends: '只打开公开参考链接，不上传记录' },
  { id: 'ocrText', title: '拍照识字后联网整理（营养标签/小票/体脂秤）', sends: '手机识别出的文字 → DeepSeek；照片不上传' },
  { id: 'foodEstimate', title: '没找到的食物联网估算', sends: '食物名称和份量 → DeepSeek；结果标“估算”，可改' },
]
type Rec = { consentAt: string; by: string; features: Record<OnlineFeature, boolean>; changedAt?: string }
const all = (on: boolean) => Object.fromEntries(ONLINE_FEATURES.map(f => [f.id, on])) as Record<OnlineFeature, boolean>
function write(r: Rec) {
  const s = currentStore(); if (!s) return
  try {
    s.setItem(ONLINE_FEATURES_KEY, JSON.stringify(r))
    // 与已有开关保持同一事实：方坤联网 / 公开资料沿用原存储键
    s.setItem(COACH_ONLINE_KEY, JSON.stringify({ on: r.features.coach, consentAt: r.changedAt ?? r.consentAt, by: r.by }))
    s.setItem(COACH_NETWORK_MODE_KEY, r.features.coachRefs ? 'public-knowledge' : 'local')
  } catch { /* session only */ }
}
/** 第一次读取（升级到 v78 后）按用户 t473 授权全部开启并记录一次同意；之后尊重用户在设置里的开关。 */
export function onlineFeatures(now = new Date().toISOString()): Rec {
  const s = currentStore()
  const stored = savedOnlineRecord(s, ONLINE_FEATURES_KEY)
  const raw = stored?.features && typeof stored.features === 'object' && !Array.isArray(stored.features)
    ? stored.features as Record<string, unknown> : {}
  const features = all(true)
  for (const feature of ONLINE_FEATURES) {
    if (Object.prototype.hasOwnProperty.call(raw, feature.id)) features[feature.id] = raw[feature.id] === true
  }
  Object.assign(features, savedOnlineChoices(s))
  const valid = typeof stored?.consentAt === 'string'
  const r: Rec = {
    consentAt: valid ? stored.consentAt as string : now,
    by: typeof stored?.by === 'string' ? stored.by : '沿用既有联网选择；新用户默认沿用已授权设置',
    features,
    ...(typeof stored?.changedAt === 'string' ? { changedAt: stored.changedAt } : {}),
  }
  if (!valid) write(r)
  return r
}
export const isOnlineOn = (f: OnlineFeature) => onlineFeatures().features[f] !== false
export function setOnlineFeature(f: OnlineFeature, on: boolean, now = new Date().toISOString()) {
  const r = onlineFeatures(now), next: Rec = { ...r, features: { ...r.features, [f]: on }, changedAt: now, by: `用户在设置中${on ? '开启' : '关闭'}「${ONLINE_FEATURES.find(x => x.id === f)?.title ?? f}」` }
  write(next); try { window.dispatchEvent(new Event('fk-online-features-changed')) } catch { /* no window */ }
  return next
}
