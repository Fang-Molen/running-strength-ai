# 1D 桌宠、快捷记录与饮食入口状态

日期：2026-10-28。状态：**本地服务和目标回归通过；浏览器完整验收与真实外部服务部分未验**。保留全部既有未提交改动；仅使用合成运动员、内存存储和临时浏览器档案，未访问生产数据、付费模型、真实食物服务，未推送或部署。

## 实际实现与证据

| 范围 | 当前行为 | 验证与边界 |
| --- | --- | --- |
| 快速解析 | `深蹲40公斤3组8次` 保留 40kg；单手/单侧/总重/自重口径保留，缺重量保持未知；`跑6.01公里26分52秒` 保存 1612 秒，`均速4分28` 不当成整课时长 | `quick-log-1d.test.ts`、`quick-log-v83.test.ts` 本轮通过。非法秒数、磅重量、模糊/未来日期、第三人、否定、计划、多课和多餐输入返回未知；显式历史日、去年、昨天保留。覆盖指定样例，不宣称任意自然语言解析完整 |
| 桌宠及等价入口 | 轻点打开“记饮食、补训练反馈、记身体状态、问方坤”；训练详情可传明确 occurrence；拖动/长按/隐藏/位置与减少动效逻辑保留；隐藏桌宠和方坤页仍有快捷入口 | 四入口及可访问弹层静态渲染通过。根节点浏览器发现桌面左侧栏遮挡快捷入口，已修复定位，实际点击复验见下文 |
| 训练反馈 | 可编辑 RPE、恢复感受、局部酸痛草稿，绑定本人已有训练；同一持久请求再次保存只返回原回执；不新建训练，不覆盖已有反馈或手表原始记录 | `pet-capture.test.ts` 本轮通过：A/B 隔离、活动数量不增、教练读取、未知/过期训练拒绝、失败保留草稿、切人后不能读写原草稿/回执 |
| 身体状态 | 记录实际日期、恢复和局部酸痛，不生成训练；通过 body-capture-context 接入教练资料 | 目标服务测试通过：当天可读、其他日期/其他运动员不可误读。当前日期环境为 UTC；真实设备时区和键盘仍待验 |
| 条件撤销 | 饮食按原回执追加撤销事件，已更正/已移除/切人时拒绝覆盖；重复撤销不重复写。训练反馈仅对满足 `undoSafe` 的导入训练提供撤销，已有后续修改则停止 | 饮食撤销、后续更正拒绝与隔离测试通过；训练导入反馈撤销及原记录保留通过。身体状态与原生训练反馈未实现通用一键撤销，需原记录更正流程；不称全部撤销场景完成 |
| 饮食入口和保存 | 复用 FoodEntrySheet 与营养事件写入；本地检索与手填可用，标注本地/自填/模型估算、品牌、地区、生熟、每100g/每份、未知营养；保存持久 requestId 与回执 | `food-entry-sheet-capture.test.tsx`、`food-capture.test.ts`、`entry-workflow.test.ts` 本轮通过。重复提交/重启读者重试仅一条；请求内容变化、撤销后重试、更正后重试不覆盖；保存失败保留日期/餐次/份量/owner/requestId；清旧草稿不丢新草稿 |
| 在线食物来源 | 明确显示“在线食物搜索未配置”；已有 DeepSeek 入口标为“模型估算（非食物搜索）”，不会假装食品目录检索 | `food-search-readiness.test.ts` 与入口渲染测试通过。未接入已授权食物目录，因此自动在线搜索、防抖、目录过期响应、许可、地区覆盖和费用未完成真实验收。模型估算保留取消/版本/owner 防陈旧响应与离线禁用，但本轮没有真实调用 |

## 本轮执行

在仓库根目录执行，环境 `FK_NO_TEST_PLAN=1`；预加载 `evaluation/deepseek-development/no-network.mjs` 禁用测试联网：

```sh
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs --test --test-concurrency=3 src/lib/ui/quick-log-1d.test.ts src/lib/ui/quick-log-v83.test.ts src/lib/ui/pet-capture.test.ts src/lib/nutrition/food-capture.test.ts src/lib/nutrition/food-search-readiness.test.ts src/components/pet/pet-capture.test.tsx src/components/food-entry-sheet-capture.test.tsx src/lib/nutrition/entry-workflow.test.ts
```

结果：**退出码 0，8 个测试文件通过，0 失败**。日志：[1d-final-focused.log](../../verification/phased-plan-20261028/1d-final-focused.log)。此为本轮重跑结果；此前 `1d-food-regression.log` 等含失败的历史日志仍保留，不作为当前通过证据。全仓类型检查、无迁移构建和整合回归由根节点汇总，详见本目录整体验收文件。

## 浏览器验收与入口修复

原脚本 [1d-browser.mjs](../../verification/phased-plan-20261028/1d-browser.mjs) 计划验证桌宠四入口、选 A 保存、双击幂等、刷新回执、拖动、长按隐藏、草稿重开、390×844 手机布局和切换运动员。本次执行因本地浏览器网络权限调用阻塞后被中断，**未生成成功结果**，不标记为通过。

根节点整合浏览器已复现可见快捷入口被主导航拦截；原因是 `fangkun-desktop.css` 在 ≥1024px 将导航改成宽 `--fk-side-w`、z-index 35 的左侧栏，入口仍为 left 12px/z-index 30。已在 `strength-app.tsx` 将入口左位置改为 `calc(var(--fk-side-w, 0px) + 12px)`，桌面移到主内容区，手机继续 12px。不使用 force click，也不提高层级遮住弹层。根节点负责修复后的实际点击、截图和 1E 复验；当前应以其最终 browser 结果为准，不能把此代码核验当作浏览器通过。

未完整验证：饮食多项搜索至一次保存的真实浏览器闭环、冷启动离线食物库、原页面与方坤多餐读取联动、实体键盘/安全区、iOS/Android 真机、生产构建浏览器表现。现入口一次保存单条食物；多食物/多餐自然语言批量草稿与一次提交尚未实现。语音和照片不阻塞文字输入，但未验证相关外部服务/授权。App 内桌宠不是系统桌面悬浮组件。

## 主要责任文件

- `src/lib/ui/quick-log.ts`、`quick-log-save.ts`：快速解析与训练草稿。
- `src/lib/ui/pet-capture.ts`、`pet-capture-navigation.ts`、`src/components/pet/pet-capture.tsx`：明确训练选择、持久反馈/状态草稿与回执。
- `src/lib/health/body-capture-context.ts`：状态接入既有教练资料。
- `src/lib/nutrition/food-capture.ts`、`entry-workflow.ts`、`log.ts`：饮食持久请求、owner 隔离与条件撤销。
- `src/lib/nutrition/food-search-readiness.ts`、`src/components/food-entry-sheet.tsx`：来源标注、未配置提示与文字入口。
- `src/components/pet/floating-pet.tsx`、`src/components/strength-app.tsx`、训练详情入口：展示与导航；本次收尾仅补快捷入口的桌面定位。
