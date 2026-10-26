/** Same-origin diagnostics. A configured key is not proof of a successful paid call. */
export type CoachServiceStatus = { state: 'configured' | 'not-configured' | 'missing-route' | 'unavailable'; model?: string; reason?: string }
const ERRORS: Record<string, string> = {
  SERVICE_DISABLED: '服务端尚未启用联网教练，本地回答仍可使用',
  TRUSTED_BINDINGS_MISSING: '服务端授权、快照或费用控制服务尚未接入，请管理员完成配置',
  SERVICE_KEY_MISSING: '服务端未配置 DeepSeek 密钥',
  AUTH_REQUIRED: '登录授权已失效，请重新登录',
  AUTH_UNAVAILABLE: '服务端暂时无法核验登录授权',
  PERSISTENCE_UNAVAILABLE: '服务端持久存储尚未就绪，授权快照和费用记录不可用',
  BUDGET_HISTORY_UNVERIFIED: '历史费用尚未核对，暂不允许新的模型调用',
  POLICY_UNVERIFIED: '服务端模型价格或额度策略尚未核验，暂不调用模型',
  BACKEND_UNAVAILABLE: '同源接口暂时无法连接教练后端，本地回答保留',
  SNAPSHOT_PERSISTENCE_UNAVAILABLE: '授权快照保存失败，未发起模型解释',
  SNAPSHOT_REVOCATION_UNAVAILABLE: '暂时无法确认服务端授权撤回，本地已停止本轮请求',
  AUTHORIZED_CONTEXT_UNAVAILABLE: '授权快照不存在、已过期或不匹配，请重新同步并授权',
  AUTHORIZATION_CHANGED: '本轮授权或训练记录已变化，请重新发起分析',
  DUPLICATE_REQUEST: '本轮请求已处理，请勿重复提交',
  BUDGET_RESERVATION_DENIED: '本轮费用额度不可用，未调用模型',
  UPSTREAM_UNCERTAIN: '模型响应未能确认，请勿自动重复调用',
  OUTPUT_REJECTED: '模型回答未通过事实或安全核验，已保留本地回答',
  ANALYSIS_OUTPUT_REJECTED: '模型分析未通过事实或安全核验，已保留本地回答',
  ANALYSIS_SEMANTIC_REVIEW_REQUIRED: '模型解释需要进一步复核，已保留本地回答',
  ANSWER_LIMIT_EXCEEDED: '模型回答超过1000字上限，已保留本地回答',
  NOT_CONFIGURED: '联网分析未配置，请管理员在服务端设置 DEEPSEEK_API_KEY',
  PROVIDER_AUTH: 'DeepSeek 密钥无效或无权限，请管理员检查服务端配置',
  PROVIDER_BALANCE: 'DeepSeek 账户余额不足，请管理员检查账户',
  PROVIDER_RATE_LIMIT: 'DeepSeek 请求限流，请稍后手动重试',
  RATE_LIMIT: '请求太频繁，请稍后手动重试',
  PROVIDER_CONFIG: 'DeepSeek 模型或请求配置不可用，请管理员检查 COACH_MODEL',
  PROVIDER_UNAVAILABLE: 'DeepSeek 服务暂时不可用，请稍后手动重试',
  PROVIDER_TIMEOUT: 'DeepSeek 响应超时，请稍后手动重试',
  PROVIDER_NETWORK: '服务端无法连接 DeepSeek，请稍后手动重试',
  PROVIDER_RESPONSE: 'DeepSeek 未返回有效回答',
  PROVIDER_TRUNCATED: 'DeepSeek 回答被截断，请缩小问题范围后重试',
  REQUEST_CANCELLED: '本轮联网请求已取消',
  BODY_TOO_LARGE: '发送内容过长，请缩小分析范围',
  INVALID_REQUEST: '联网请求格式错误',
  INVALID_QUESTION: '问题为空、含无效字符或超过1000字',
  INVALID_FACTS: '事实摘要格式错误或过长，请缩小分析范围',
}
const knownError = (code: unknown): string | undefined => typeof code === 'string' && Object.hasOwn(ERRORS, code) ? ERRORS[code] : undefined
const missingRoute = '当前部署未提供有效的 /api/coach-chat 接口，请管理员检查服务端部署'
export type DecodedCoachAnswer={text:string;source?:'LOCAL'|'MODEL';model?:string}
export async function readCoachResponse(response: Response): Promise<DecodedCoachAnswer | { error: string }> {
  if ([404,405].includes(response.status) || response.headers.get('content-type')?.includes('text/html')) return { error: missingRoute }
  const data = await response.json().catch(() => null)
  if (response.ok && data?.ok === true && data.planChanged === false && typeof data.text === 'string' && data.text.trim() && data.text.length <= 1000) {
    if(data.route==='LOCAL'&&data.model===null)return {text:data.text,source:'LOCAL'}
    if(['LOW','COMPLEX'].includes(data.route)&&typeof data.model==='string'&&/^[A-Za-z0-9_.:/-]{1,80}$/.test(data.model))return {text:data.text,source:'MODEL',model:data.model}
    return {text:data.text} // Legacy readers remain compatible; new consent flow requires explicit provenance.
  }
  const known = knownError(data?.error) ?? knownError(data?.code)
  return { error: known ?? (response.status === 401 || response.status === 403 ? '当前登录或访问权限不可用，请重新登录后重试' : response.status === 429 ? ERRORS.RATE_LIMIT : response.status === 503 ? '联网服务尚未就绪，请管理员检查配置' : '联网服务未返回有效回答，请稍后手动重试') }
}
export async function coachServiceInfo(signal?: AbortSignal): Promise<CoachServiceStatus> {
  const controller = new AbortController(), cancel = () => controller.abort()
  const timer = setTimeout(cancel, 5000)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    const response = await fetch('/api/coach-chat', { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
    if ([404,405].includes(response.status) || response.headers.get('content-type')?.includes('text/html')) return { state: 'missing-route' }
    const data = await response.json().catch(() => null)
    if (!response.ok || data?.service !== 'fangkun-coach' || typeof data.configured !== 'boolean') return { state: 'unavailable' }
    return { state: data.configured ? 'configured' : 'not-configured', ...(knownError(data.reason) ? { reason: knownError(data.reason) } : {}), ...(typeof data.model === 'string' ? { model: data.model.slice(0,80) } : {}) }
  } catch { return { state: 'unavailable' } }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export function coachServiceStatusText(status: CoachServiceStatus | null): string {
  if (!status) return '正在检查服务端配置（不调用模型）…'
  if (status.state === 'configured') return `已配置 ${status.model ?? 'DeepSeek'}；实际连接和余额未验证。本检查不调用模型、不上传训练记录。`
  if (status.state === 'not-configured') return status.reason ?? '联网服务配置尚未完成，本地回答仍可使用'
  if (status.state === 'missing-route') return missingRoute
  return '暂时无法检查联网服务；这不代表已连接 DeepSeek。'
}
