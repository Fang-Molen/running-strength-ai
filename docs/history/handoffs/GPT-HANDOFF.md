# 跑步力量 · GPT 交接说明

版本：UX-FIRST-01，基于 RUN-EXEC-02 独立开发副本。
打包日期：2026-10-10。
这不是线上试用版。正式工作区 `/workspace` 没有这次田径执行和今日首页改动，不要用它覆盖本包。

## 怎么启动

```bash
npm ci
npm run dev
```

开发服务器：`0.0.0.0:8080`。

```bash
npm run typecheck
npm test
npm run build
```

`npm test` 分三段：scripts 的 node:test、auth/app-data 的 strip-types 测试、`npx tsx --test` 的应用测试。
本包打包前最后一次实际结果：206 + 55 + 295 = 556，失败 0。TypeScript 通过。生产构建通过。
浏览器只在隔离的桌面 Chromium 里测过今日流程和 375/390/393/402/414 宽度。iPhone 真机和系统键盘遮挡没有测。

TanStack Start 为 1.168.60。安装名来自 `scripts/grok-pwa-shared.mjs` 的 `HOME_SCREEN_NAME = "跑步力量"`。Service Worker 缓存名是 `fr255-shell-2`。平台模板曾把该文件改回宿主名，恢复工作区时要再核对。

## 已完成

- 今日页田径卡在最上面：已保存计划的结构、计划休息、开始或继续、这次进度、上一节摘要。没有计划时不编造训练。
- 200m×4×2、400m+200m，以及自定义距离、次数、轮数和组合。计划按 Session → Component → Block → Step 保存。
- 逐段完成、跳过、未记录。实际休息可记。留空不会写成 0。重复点击不会再写一条。
- 已开始的计划快照不会被后来的编辑改掉。
- 刷新后从第一条未完成的段继续。
- 力量训练执行、暂停本页有效、重复点击防护、训练日志纠错、作废、恢复。纠错绑定 occurrenceId + moveId + setIndex。原始事件不删除。
- 日志按 occurrence 展示田径分段。按钮文案是「问教练」，不是自动复盘。
- 多运动首页偏好保存在本机。五个底栏仍是今日、计划、日志、教练、身体。
- 身体页可以手填体重、饮食、热量，以及手表的全天总消耗。截图只在当页预览，不识别、不入库。
- 证据不足时，力量卡先写原因，不把 UNKNOWN 写成「建议维持原计划」。没有睡眠却得到 READY 时，警告在「状态良好」前面。决策结果没有改。

## 未完成，不要写成已完成

- 设备同步未启用。不会连接健康平台、手表账号或蓝牙，也不会后台自动同步。
- 截图不会 OCR。
- 田径计划没有名称和备注字段。不能靠加字段假装已经支持。
- 田径执行不会写训练结束事件，完成度进不了现有决策。
- 没有睡眠记录时，决策引擎仍可能返回 READY。界面只隔离了这句话，没有改算法。
- 休息倒计时和暂停不跨刷新保存。
- iPhone 真机、离线冷启动、系统键盘遮挡：未测。
- 本包没有合并进正式工作区，也没有发布到线上试用版。

## 冻结合同，不要改

- AI Brain V3.3、AthleteState、Decision Engine、Safety
- Canonical Training、Event、Evidence、Memory、Override
- `src/lib/core/training-decision.ts` 的决策公式
- 训练事件和存储 schema
- 不要清空或迁移用户 localStorage / IndexedDB

可以改的是界面和 `src/lib/ui/running-workouts.ts` 这一层。逐段记录必须走现有 `recordRunningRepetitionCompleted`、`recordRunningRepetitionSkipped`、`recordRunningRecovery`。计划与实际分开。跳过不是完成，未记录不是跳过。

## 数据

训练事实在本机 `localStorage`，事件信封键为 `fr255-events-v1`。这个 ZIP 不含任何用户训练数据。
