/** 桌宠总开关。设为 false：桌宠完全不渲染、不请求任何图片，界面回到接入前的样子。 */
export const PET_ENABLED = true
export const PET_BASE = '/fangkun-pet/chiyan'
/** 桌宠角色表：电脑人（经典主题）+ 七套主题角色。图片都在 public/fangkun-pet/<dir>/<mood>.webp。 */
export const PET_ROLES = {
  robot: { id: 'robot', dir: 'robot', name: '电脑人', fullbody: '/fangkun-pet/robot/robot-fullbody.webp' },
  chiyan: { id: 'chiyan', dir: 'chiyan', name: '赤焰·逐风', fullbody: '/fangkun-pet/chiyan/chiyan-fullbody.webp' },
  xuanjin: { id: 'xuanjin', dir: 'xuanjin', name: '玄金·智衡', fullbody: '/fangkun-pet/xuanjin/xuanjin-fullbody.webp' },
  lingyue: { id: 'lingyue', dir: 'lingyue', name: '灵跃·同行', fullbody: '/fangkun-pet/lingyue/lingyue-fullbody.webp' },
  qingye: { id: 'qingye', dir: 'qingye', name: '青野·长行', fullbody: '/fangkun-pet/qingye/qingye-fullbody.webp' },
  anlan: { id: 'anlan', dir: 'anlan', name: '暗澜·突破', fullbody: '/fangkun-pet/anlan/anlan-fullbody.webp' },
  liuguang: { id: 'liuguang', dir: 'liuguang', name: '流光·自在', fullbody: '/fangkun-pet/liuguang/liuguang-fullbody.webp' },
  shanyue: { id: 'shanyue', dir: 'shanyue', name: '山月·守衡', fullbody: '/fangkun-pet/shanyue/shanyue-fullbody.webp' },
} as const
export type PetRoleId = keyof typeof PET_ROLES
/** 主题 → 桌宠角色：经典（以及任何未知值）= 电脑人，其余主题 id 与角色 id 相同。 */
export function petRoleForTheme(theme: string | undefined | null): PetRoleId {
  return typeof theme === 'string' && theme !== 'robot' && Object.prototype.hasOwnProperty.call(PET_ROLES, theme) ? theme as PetRoleId : 'robot'
}
export function petMoodSrc(role: PetRoleId, mood: string): string { return `/fangkun-pet/${PET_ROLES[role].dir}/${mood}.webp` }
/** 悬浮桌宠总开关。设为 false：悬浮桌宠完全不渲染（聊天头像、体型模拟立绘不受影响）。 */
export const FLOATING_PET_ENABLED = true
/** 悬浮桌宠的位置 / 显示偏好存在本机 localStorage。 */
export const FLOATING_PET_POS_KEY = 'fk-pet-pos-v1'
export const FLOATING_PET_VISIBLE_KEY = 'fk-pet-visible-v1'
