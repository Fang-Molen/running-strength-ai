# V10 完成页压缩与证据时效性修复

- UI: `src/components/training-decision-card.tsx` 训练完成摘要默认仅显示动作/完成组/跳过组、原口径训练总量、反馈。逐组详情改为默认折叠的 `<details>`，展开保留计划/实际/偏差/状态。原始事实与事件写入未修改。
- Brain: `athlete-evidence-readiness.ts` 新增只读证据时效性检查：未来日期、超过7天的会话/恢复、证据冲突、无效参考日期；不生成训练处方或诊断。
- 测试: Node 22 `--experimental-strip-types --test` 三个测试文件共18/18通过。
- 未执行: TypeScript全项目类型检查、生产构建、iOS真机UI/计时、正式训练记录永久删除；没有安装依赖，没有线上发布。
- 风险: `summary.planned` 和 `summary.actual` 的量纲沿用原系统，不能据此断言训练负荷变化。证据7天时效仅为缺口提示阈值，不是恢复生理学判断。
