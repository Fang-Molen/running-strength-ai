/** FRAME-02: read-only device export guidance; no account connections or imported facts. */
export type DeviceGuide = {
  id: string
  brand: string
  route: string
  format: string
  steps: readonly string[]
  caution: string
}
export const DEVICE_GUIDES: readonly DeviceGuide[] = [
  {id:'generic',brand:'通用运动设备',route:'设备配套应用的历史活动或数据导出',format:'FIT / TCX / GPX / CSV（取决于设备）',steps:['选择自己的实际活动。','查找数据导出并保存原文件。','保留来源与时间，导入后核对，不将计划当完成。'],caution:'不同设备字段不同，未记录不代表正常。'},
  { id: 'coros', brand: 'COROS 高驰', route: 'COROS App → 活动详情', format: '通常可导出 FIT', steps: ['打开 COROS App 并进入历史活动。', '选择目标活动，在分享或更多选项中查找「导出数据」。', '将 FIT 文件保存到本地，等待导入功能上线。'], caution: '菜单名称可能随系统及 App 版本变化。' },
  { id: 'apple', brand: 'Apple Watch / Apple 健康', route: 'iPhone「健康」→ 个人头像 → 导出所有健康数据', format: 'ZIP / XML（不同于单次活动 FIT）', steps: ['打开 iPhone「健康」App。', '点击个人头像，选择「导出所有健康数据」。', '妥善保管 ZIP；包含大量个人健康信息。'], caution: '这是全量健康档案，不是单次训练导出；本 App 目前不能解析此 ZIP。' },
  { id: 'suunto', brand: 'Suunto 颂拓', route: 'Suunto App → 活动详情 → 更多 / 导出', format: '依版本支持 FIT 或 GPX', steps: ['打开 Suunto App，进入某次运动记录。', '查看分享、更多或导出菜单。', '保存可用格式到本地。'], caution: '不同版本和活动类型可导出的字段可能不同。' },
  { id: 'polar', brand: 'Polar 博能', route: 'Polar Flow 网页 → 日记 → 活动', format: '依活动支持 FIT / TCX / CSV / GPX', steps: ['在电脑浏览器登录 Polar Flow。', '从日记中打开目标训练活动。', '在活动详情中选择可用的导出格式并保存。'], caution: '并非所有格式都包含同等的训练指标。' },
  { id: 'huawei', brand: '华为 / 荣耀', route: '对应健康 App 的活动详情或数据管理', format: '依设备、地区和版本而异', steps: ['打开手表对应的健康 App，找到运动历史。', '检查活动分享、路线导出或个人数据导出选项。', '若只有截图或路线文件，先保留原始活动记录。'], caution: '不能保证直接导出 FIT；路线 GPX 不等于完整运动数据。' },
  { id: 'xiaomi', brand: '小米 / Redmi', route: '小米运动健康等对应 App', format: '需核对具体型号与版本', steps: ['打开设备所使用的运动健康 App。', '进入历史运动记录，检查分享和数据导出。', '若无法导出完整文件，可先手动记录训练。'], caution: '暂不承诺所有型号支持 FIT、GPX 或自动同步。' },
  { id: 'amazfit', brand: 'Amazfit / Zepp', route: 'Zepp App → 活动历史或账户数据', format: '依设备、地区和版本而异', steps: ['打开 Zepp App，进入历史活动。', '查看分享、导出或个人数据下载选项。', '保留原始文件及导出日期。'], caution: '部分分享只生成图片，不是结构化训练文件。' },
  { id: 'samsung', brand: 'Samsung Galaxy Watch', route: 'Samsung Health / Health Connect', format: '依平台和导出方式而异', steps: ['打开 Samsung Health，查看活动详情和个人数据选项。', '确认可导出的内容及格式。', '无法导出时，可先使用手动训练记录。'], caution: 'Health Connect 不等于浏览器 PWA 可以直接读取；自动同步需要另行授权集成。' },
  { id: 'other', brand: '其他设备 / 无手表', route: '手动录入或查看品牌官方帮助', format: '后续支持格式以解析器验收为准', steps: ['先在原厂 App 保留训练历史。', '记录运动日期、距离、时间、圈次和主观强度。', '未来导入时先预览、核对来源，再确认保存。'], caution: '没有设备也可以完整使用训练计划和执行功能。' },
] as const
