/** Explicit network consent; no network access or data upload happens in this module. */
export type CoachNetworkMode = 'local' | 'public-knowledge'
export const COACH_NETWORK_MODE_KEY = 'fr255-coach-network-mode-v1'
export function parseCoachNetworkMode(value: unknown): CoachNetworkMode {
  return value === 'public-knowledge' ? 'public-knowledge' : 'local'
}
export type NetworkAction = 'local-answer' | 'open-public-reference' | 'send-private-data' | 'invoke-paid-model'
export function authorizeNetworkAction(args: {
  mode: CoachNetworkMode;
  action: NetworkAction;
  explicitDataConsent?: boolean;
  serverAuthorized?: boolean;
  online?: boolean;
}): { allowed: boolean; reason: string } {
  if (args.action === 'local-answer') return { allowed: true, reason: '本地问答无需联网' }
  if (args.mode !== 'public-knowledge') return { allowed: false, reason: '联网知识功能未开启' }
  if (args.online === false) return { allowed: false, reason: '设备离线' }
  if (args.action === 'open-public-reference') return { allowed: true, reason: '仅打开公开资料，不上传本地训练记录' }
  if (!args.explicitDataConsent) return { allowed: false, reason: '需要本次明确的数据发送同意' }
  if (!args.serverAuthorized) return { allowed: false, reason: '需要服务端核验授权及额度' }
  return { allowed: true, reason: '已获得本次同意与服务端授权' }
}
export const COACH_PUBLIC_REFERENCES = [
  { id: 'ais', label: '澳大利亚体育学院 · 运动营养', url: 'https://www.ais.gov.au/nutrition' },
  { id: 'acsm', label: '美国运动医学会 · 运动与健康资源', url: 'https://www.acsm.org/' },
  { id: 'ioc', label: '国际奥委会 · 运动员健康资源', url: 'https://olympics.com/ioc/medical-and-scientific' },
] as const
