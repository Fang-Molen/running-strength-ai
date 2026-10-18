import { validReading, type DeviceConfirmed } from '../core/device-image-evidence'
import type { DeviceHealthRow, HealthMetric } from './device-store'
import { localDay, shortHash, validDay } from './observation'
/** Called only from the explicit reviewed-evidence action; does not import training or infer a resting HR. */
export function deviceEvidenceHealthRows(record:DeviceConfirmed):DeviceHealthRow[]{
  if(record.consent!=='USER_CONFIRMED'||!Number.isFinite(Date.parse(record.recordedAt)))return []
  const day=record.recordedAt.length===10?record.recordedAt:localDay(new Date(record.recordedAt));if(!validDay(day))return []
  const metrics:Record<string,HealthMetric>={SLEEP_HOURS:'SLEEP',HRV_MS:'HRV',RESTING_HR_BPM:'RHR',SPO2_PERCENT:'SPO2'}
  return record.readings.filter(r=>validReading(r)&&metrics[r.metric]).map(r=>({key:`evidence:${record.id}:${r.id}`,source:`截图核对 · ${record.deviceLabel}`.slice(0,80),metric:metrics[r.metric],day,value:r.value,hrvMethod:'UNSPECIFIED',observation:{key:`image:${shortHash(record.id)}:${shortHash(r.id)}`,sourceId:`image:${shortHash(record.deviceLabel)}`,statistic:'截图确认；统计口径未提供',syncedAt:record.confirmedAt,measuredAt:record.recordedAt.length===10?null:record.recordedAt,rawValue:r.value,rawUnit:r.unit}}))
}
