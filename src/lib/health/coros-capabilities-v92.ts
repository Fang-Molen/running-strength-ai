import type { Adapted } from './coros-evidence-v92'
/** UI labels must reflect received evidence, not brand marketing or login state. */
export function corosRecoveryAvailability(a:Adapted){
 const valid=a.sourceId!==null
 return {
  provider:'COROS' as const,
  loginVerified:valid,
  intradayHeartRate:valid&&a.capabilities.heartRate?'AVAILABLE' as const:'NO_DATA' as const,
  intradayStress:valid&&a.capabilities.stress?'AVAILABLE' as const:'NO_DATA' as const,
  bodyBattery:'UNSUPPORTED' as const,
  bodyBatteryLabel:'高驰未提供 Garmin Body Battery，不生成替代值',
  napEvents:valid&&a.capabilities.napEvents?'AVAILABLE' as const:'NO_CONFIRMED_NAP' as const,
  muscleScenario:valid&&a.capabilities.workouts?'POSSIBLE_WITH_TRAINING_DETAIL' as const:'NO_CONFIRMED_WORKOUT' as const,
  referenceLine:'REQUIRES_COMPARABLE_HISTORY' as const,
  note:'同设备同协议历史满足有效样本门槛后才显示参考线；训练摘要不能推算力量组次。'
 }
}
