/** FRAME-04: read-only energy source contract. No storage or decision writes. */
export type EnergySource = "DEVICE_TOTAL" | "PROFILE_ESTIMATE";
export type EnergyBasis = {
  source: EnergySource;
  totalDailyKcal: number | null;
  targetKcal: number | null;
  trainingKcalIncluded: boolean;
  warning: string | null;
};

/** Device TOTAL is resting + active energy, not a workout-only burn. */
export function energyBasis(
  estimatedTarget: number | null,
  estimatedMaintenance: number | null,
  deviceDailyTotal: number | null,
): EnergyBasis {
  const valid = deviceDailyTotal !== null && Number.isFinite(deviceDailyTotal) && deviceDailyTotal > 0;
  if (!valid) {
    return {
      source: "PROFILE_ESTIMATE", totalDailyKcal: null,
      targetKcal: estimatedTarget, trainingKcalIncluded: false,
      warning: "尚无可信的设备全天总消耗；使用个人资料估算，不把训练活动热量自动叠加。",
    };
  }
  const targetKcal = estimatedTarget === null || estimatedMaintenance === null
    ? null
    : Math.max(1200, Math.min(6000, Math.round(deviceDailyTotal + estimatedTarget - estimatedMaintenance)));
  return {
    source: "DEVICE_TOTAL", totalDailyKcal: deviceDailyTotal,
    targetKcal, trainingKcalIncluded: true,
    warning: "设备全天总消耗通常已包含训练消耗，不能再叠加单次跑步或力量训练热量。",
  };
}
