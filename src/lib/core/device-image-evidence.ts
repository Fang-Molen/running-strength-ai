/** BUILD 39: conservative offline text-to-evidence parser. No OCR/network/model calls. */
export type DeviceMetric = 'SLEEP_HOURS' | 'HRV_MS' | 'RESTING_HR_BPM' | 'AVERAGE_HR_BPM' | 'WEIGHT_KG' | 'BODY_FAT_PERCENT' | 'SPO2_PERCENT' | 'RUN_SPLIT' | 'STRENGTH_SET'
export type DeviceReading = {
  id: string
  metric: DeviceMetric
  value: number
  unit: 'h' | 'ms' | 'bpm' | 'kg' | '%' | 's'
  rawLine: string
  sourceLine: number
  provenance: 'LOCAL_PATTERN' | 'USER_EDITED'
  details?: { distanceMeters?: number; recoverySeconds?: number; heartRateBpm?: number; round?: number; repeat?: number; exercise?: string; setOrdinal?: number; repetitions?: number }
}
export type DeviceDraft = { readings: DeviceReading[]; warnings: string[]; rawText: string }
export type DeviceConfirmed = {
  id: string; schemaVersion: 1; deviceLabel: string; recordedAt: string; confirmedAt: string
  imageName: string | null; imageSha256: string | null; textOrigin: 'BROWSER_OCR_REVIEWED' | 'USER_TRANSCRIBED' | 'NETWORK_OCR_REVIEWED'; rawText: string; readings: DeviceReading[]
  consent: 'USER_CONFIRMED'; destination: 'DEVICE_EVIDENCE_ONLY'
}
const bounds: Record<DeviceMetric, [number, number]> = {
  SLEEP_HOURS: [0.1, 24], HRV_MS: [1, 400], RESTING_HR_BPM: [20, 200], AVERAGE_HR_BPM: [20, 240],
  WEIGHT_KG: [20, 400], BODY_FAT_PERCENT: [1, 75], SPO2_PERCENT: [50, 100], RUN_SPLIT: [0.1, 86400], STRENGTH_SET: [0, 600],
}
export function validReading(reading: DeviceReading): boolean {
  if (!reading || !Number.isFinite(reading.value)) return false
  const range = bounds[reading.metric]
  if (!range || reading.value < range[0] || reading.value > range[1]) return false
  if (reading.metric === 'RUN_SPLIT') return reading.unit === 's' && Number.isFinite(reading.details?.distanceMeters) && (reading.details?.distanceMeters ?? 0) > 0 && (reading.details?.distanceMeters ?? 0) <= 50000 && (reading.details?.heartRateBpm === undefined || (reading.details.heartRateBpm >= 20 && reading.details.heartRateBpm <= 240)) && (reading.details?.recoverySeconds === undefined || (reading.details.recoverySeconds >= 0 && reading.details.recoverySeconds <= 86400))
  if (reading.metric === 'STRENGTH_SET') return reading.unit === 'kg' && !!reading.details?.exercise?.trim() && Number.isInteger(reading.details?.repetitions) && (reading.details?.repetitions ?? 0) >= 1 && (reading.details?.repetitions ?? 0) <= 500
  return reading.unit === ({SLEEP_HOURS:'h',HRV_MS:'ms',RESTING_HR_BPM:'bpm',AVERAGE_HR_BPM:'bpm',WEIGHT_KG:'kg',BODY_FAT_PERCENT:'%',SPO2_PERCENT:'%'} as Record<string,string>)[reading.metric]
}
function durationSeconds(raw: string): number | null {
  const clean = raw.trim()
  const colon = /^(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?$/.exec(clean)
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]) + Number(`0.${colon[3] ?? '0'}`)
  const num = /^(\d+(?:\.\d+)?)\s*(?:s|秒|sec)$/i.exec(clean)
  return num ? Number(num[1]) : null
}
export function parseDeviceEvidence(text: string): DeviceDraft {
  const rawText = text.slice(0, 12000)
  const readings: DeviceReading[] = []
  const warnings: string[] = []
  const lines = rawText.split(/\r?\n/).slice(0, 150)
  const add = (line: string, index: number, metric: DeviceMetric, value: number, unit: DeviceReading['unit'], details?: DeviceReading['details']) => {
    const reading: DeviceReading = { id: `line-${index + 1}-${readings.length + 1}`, metric, value, unit, rawLine: line, sourceLine: index + 1, provenance: 'LOCAL_PATTERN', ...(details ? {details} : {}) }
    if (validReading(reading)) readings.push(reading)
    else warnings.push(`第 ${index + 1} 行：${metric} 数值或单位异常，未采纳；请人工核对。`)
  }
  for (const [index, original] of lines.entries()) {
    const line = original.trim().replace(/，/g, ',').replace(/×/g, 'x')
    if (!line) continue
    // Detailed lap first: never infer that a distance without a time was completed.
    const lap = /(?:第\s*(\d+)\s*(?:段|圈|组|次)|(?:lap|split|分段)\s*#?\s*(\d+))\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(km|m|公里|米)\s*[,，\s]+(\d{1,2}:\d{2}(?:\.\d{1,2})?|\d+(?:\.\d+)?\s*(?:s|秒|sec))/i.exec(line)
    if (lap) {
      const dist = Number(lap[3]) * (/^(km|公里)$/i.test(lap[4]) ? 1000 : 1)
      const duration = durationSeconds(lap[5])
      const hr = /(?:心率|HR)\s*[:：]?\s*(\d{2,3})\s*(?:bpm|次\/分)?/i.exec(line)
      const recovery = /(?:恢复|休息|rest)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(s|秒|分|min)/i.exec(line)
      if (duration !== null) add(line, index, 'RUN_SPLIT', duration, 's', {distanceMeters:dist, repeat:Number(lap[1] ?? lap[2]), ...(hr ? {heartRateBpm:Number(hr[1])} : {}), ...(recovery ? {recoverySeconds:Number(recovery[1]) * (/^(分|min)$/i.test(recovery[2]) ? 60 : 1)} : {})})
      continue
    }
    const strength = /^(.{1,24}?)\s*(?:第\s*(\d+)\s*组|set\s*(\d+))\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)\s*[xX*×]\s*(\d+)\s*(?:次|reps?)?/i.exec(line)
    if (strength) { add(line,index,'STRENGTH_SET',Number(strength[4]),'kg',{exercise:strength[1].trim(),setOrdinal:Number(strength[2] ?? strength[3]),repetitions:Number(strength[5])}); continue }
    const metricPatterns: {metric:DeviceMetric; regex:RegExp; unit:DeviceReading['unit']; convert?: (match:RegExpExecArray)=>number}[] = [
      {metric:'SLEEP_HOURS', regex:/(?:睡眠(?:时长)?|sleep(?:\s+duration)?)\s*[:：]?\s*(\d{1,2})\s*(?:小时|h|hr)(?:\s*(\d{1,2})\s*(?:分|分钟|m|min))?/i,unit:'h',convert:m=>Number(m[1])+(m[2]?Number(m[2])/60:0)},
      {metric:'SLEEP_HOURS', regex:/(?:睡眠(?:时长)?|sleep(?:\s+duration)?)\s*[:：]?\s*(\d{1,2}):(\d{2})\b/i,unit:'h',convert:m=>Number(m[1])+Number(m[2])/60},
      {metric:'HRV_MS', regex:/(?:\bHRV\b|心率变异性)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:ms|毫秒)/i,unit:'ms'},
      {metric:'RESTING_HR_BPM', regex:/(?:静息心率|resting\s*(?:heart\s*rate|HR)|\bRHR\b)\s*[:：]?\s*(\d{2,3})\s*(?:bpm|次\/分)?/i,unit:'bpm'},
      {metric:'AVERAGE_HR_BPM', regex:/(?:平均心率|avg\s*(?:heart\s*rate|HR))\s*[:：]?\s*(\d{2,3})\s*(?:bpm|次\/分)?/i,unit:'bpm'},
      {metric:'WEIGHT_KG', regex:/(?:体重|body\s*weight|weight)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/i,unit:'kg'},
      {metric:'BODY_FAT_PERCENT', regex:/(?:体脂率?|body\s*fat)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i,unit:'%'},
      {metric:'SPO2_PERCENT', regex:/(?:血氧|SpO2)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i,unit:'%'},
    ]
    const found = new Set<DeviceMetric>()
    for (const pattern of metricPatterns) {
      if (found.has(pattern.metric)) continue
      const match = pattern.regex.exec(line)
      if (match) { add(line,index,pattern.metric,pattern.convert ? pattern.convert(match) : Number(match[1]),pattern.unit); found.add(pattern.metric) }
    }
  }
  if (!readings.length) warnings.push('没有识别到可靠的结构化数值；可手动录入，不能将空白视为正常。')
  const seen = new Set<string>()
  for (const reading of readings) {
    const signature = `${reading.metric}:${reading.value}:${JSON.stringify(reading.details ?? {})}`
    if (seen.has(signature)) warnings.push(`疑似重复：${reading.metric} ${reading.value}，请核对是否来自同一屏幕或不同时间。`)
    seen.add(signature)
  }
  return {readings,warnings,rawText}
}
export function validateDeviceConfirmation(args: {draft: DeviceDraft; deviceLabel: string; recordedAt: string; acknowledged: boolean}): string[] {
  const errors: string[] = []
  if (!args.acknowledged) errors.push('必须人工核对并确认来源')
  if (!args.deviceLabel.trim() || args.deviceLabel.trim().length > 80) errors.push('需要设备或数据来源')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(args.recordedAt) || !Number.isFinite(Date.parse(args.recordedAt))) errors.push('采集时间必须带时区，不能猜测截图日期')
  if (!args.draft.readings.length) errors.push('至少需要一条有效读数')
  if (args.draft.readings.some(r=>!validReading(r))) errors.push('存在不合法读数')
  const signatures = args.draft.readings.map(r=>`${r.metric}:${r.value}:${JSON.stringify(r.details ?? {})}`)
  if (new Set(signatures).size !== signatures.length) errors.push('存在疑似重复读数，请删除重复项或拆成不同采集记录')
  return errors
}
export function makeDeviceRecord(args: {draft: DeviceDraft; deviceLabel: string; recordedAt: string; acknowledged: boolean; imageName: string|null; imageSha256: string|null; textOrigin?: 'BROWSER_OCR_REVIEWED' | 'USER_TRANSCRIBED' | 'NETWORK_OCR_REVIEWED'; confirmedAt: string; id: string}): DeviceConfirmed {
  const errors = validateDeviceConfirmation(args)
  if (errors.length) throw new Error(errors.join('；'))
  return {id:args.id,schemaVersion:1,deviceLabel:args.deviceLabel.trim(),recordedAt:args.recordedAt,confirmedAt:args.confirmedAt,imageName:args.imageName,imageSha256:args.imageSha256,textOrigin:args.textOrigin??'USER_TRANSCRIBED',rawText:args.draft.rawText,readings:args.draft.readings.map(r=>({...r,details:r.details ? {...r.details} : undefined})),consent:'USER_CONFIRMED',destination:'DEVICE_EVIDENCE_ONLY'}
}
