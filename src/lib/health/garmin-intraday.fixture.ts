/** 测试/QA 用的合成响应（不是用户数据），形状依据 python-garminconnect 与 garmin-grafana 的字段用法。 */
const prevDay = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }
export function fixtureHeartRate(day: string, upToHour = 24) {
  const t0 = Date.parse(day + 'T00:00:00+08:00'), values: [number, number | null][] = []
  for (let m = 0; m < upToHour * 60; m += 2) {
    const h = m / 60, sleep = h < 6.5, run = h >= 18 && h < 18.8
    const v = sleep ? 50 + Math.round(3 * Math.sin(m / 37)) : run ? 150 + Math.round(12 * Math.sin(m / 5)) : 68 + Math.round(10 * Math.sin(m / 53) + 4 * Math.sin(m / 7))
    values.push([t0 + m * 60e3, m % 97 === 0 ? null : v])
  }
  return { userProfilePK: 1, calendarDate: day, startTimestampGMT: `${prevDay(day)}T16:00:00.0`, endTimestampGMT: `${day}T16:00:00.0`, startTimestampLocal: `${day}T00:00:00.0`, endTimestampLocal: `${prevDay(day) < day ? day : day}T23:59:59.0`,
    maxHeartRate: 165, minHeartRate: 46, restingHeartRate: 49, lastSevenDaysAvgRestingHeartRate: 50,
    heartRateValueDescriptors: [{ key: 'timestamp', index: 0 }, { key: 'heartrate', index: 1 }], heartRateValues: values }
}
export function fixtureStress(day: string, upToHour = 24) {
  const t0 = Date.parse(day + 'T00:00:00+08:00'), bb: [number, string, number, number][] = []
  let level = 30
  for (let m = 0; m < upToHour * 60; m += 3) {
    const h = m / 60
    level += h < 6.5 ? 0.5 : h >= 18 && h < 18.8 ? -0.9 : -0.12
    bb.push([t0 + m * 60e3, 'MEASURED', Math.max(5, Math.min(100, Math.round(level))), 2.0])
  }
  return { userProfilePK: 1, calendarDate: day, startTimestampGMT: `${prevDay(day)}T16:00:00.0`, endTimestampGMT: `${day}T16:00:00.0`, startTimestampLocal: `${day}T00:00:00.0`, endTimestampLocal: `${day}T23:59:59.0`,
    maxStressLevel: 80, avgStressLevel: 30, stressValuesArray: [],
    bodyBatteryValueDescriptorsDTOList: [{ bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' }, { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryStatus' }, { bodyBatteryValueDescriptorIndex: 2, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' }, { bodyBatteryValueDescriptorIndex: 3, bodyBatteryValueDescriptorKey: 'bodyBatteryVersion' }],
    bodyBatteryValuesArray: bb }
}
export function fixtureSleep(day: string) {
  return { dailySleepDTO: { calendarDate: day, sleepTimeSeconds: 23400, sleepStartTimestampGMT: Date.parse(prevDay(day) + 'T23:40:00+08:00'), sleepEndTimestampGMT: Date.parse(day + 'T06:30:00+08:00') } }
}
