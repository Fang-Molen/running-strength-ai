# FRAME-18 身体中心信息架构第一阶段
状态：IMPLEMENTED / UNVERIFIED（未发布）

已修改 src/components/body-center.tsx：
- 增加身体与恢复中心总览及四个快捷锚点（睡眠/HRV、体重/体测、饮食/热量、设备数据）。
- 今日监测覆盖数从原有监测记录只读计算，缺失不当作正常；今日体重只按日期判定，历史数据继续保留。
- 原有 VitalsPanel、BodyPanel、FuelPanel、DeviceCenter 保留，不替换存储或食物库。
- 不修改训练事实、AI Brain、模型接口、设备授权、卡券与奖励。
未验证：项目没有 node_modules，本轮未完成 TypeScript、生产构建、全量测试或手机实测。
后续：监测记录来源和时间戳、数据质量/设备导入状态、趋势图统一视觉、与训练后反馈关联，均须先审计再开发。
