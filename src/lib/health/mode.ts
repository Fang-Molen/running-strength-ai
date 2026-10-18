import type { HealthSnapshot } from './snapshot'
import type { WatchId } from './legacy-inputs'
/** Device choice controls entry hints, never manufactures measurements or discards valid records. */
export function healthModeSummary(watch:WatchId|null,snapshot:HealthSnapshot){
 const descriptions={
  pro:{label:'专业运动手表',description:'结合已导入的健康与训练明细。分段、HRV等以实际提供为准，不因选择专业表就假定存在。'},
  basic:{label:'普通健康手表',description:'结合已有睡眠、心率、活动和手动训练记录；没有HRV也可做有限复核，有有效明细仍可使用。'},
  none:{label:'无手表',description:'用实际训练、睡眠、疲劳感和疼痛反馈复核；无需HRV、身体电量或购买设备。'},
  unset:{label:'尚未选择设备',description:'可先手动记录训练、睡眠和感受。选择设备类型不等于已经连接账号。'}
 }
 const mode=watch??'unset',value=descriptions[mode]
 return {mode:mode as WatchId|'unset',...value,available:snapshot.metrics.filter(x=>x.state==='AVAILABLE').length,conflicts:snapshot.metrics.filter(x=>x.state==='CONFLICT').length,reminder:'切换类型保留全部历史记录；判断取决于有效证据，不取决于版本名称。'}
}
