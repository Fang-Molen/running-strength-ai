# 本轮验证总表

最终整理2026-10-29。源码基线9263254；仅合成数据，FK_NO_TEST_PLAN=1。所有路径相对 `verification/phased-plan-20261028/`；`.exit`是实际退出码，`.log`是输出。测试文件计数不是断言数，也不是54项能力通过数。

| 验证 | 实际结果 | 证据 |
|---|---|---|
| 包内7文件SHA与Git完整提交 | 已核对 | baseline-identity.json、START-HERE |
| 基线类型/coach-qa/cycle | 退出0 | baseline-typecheck、baseline-coach-qa、baseline-cycle |
| 基线无迁移构建 | 默认沙箱监听EPERM；获本地网络权限后退出0 | baseline-build-dev、baseline-build-dev-network |
| 最新类型检查 | 退出0 | final-typecheck |
| coach-qa | 退出0，9测试文件 | final-coach-qa |
| 最新cycle | 退出0，13测试文件（含新增截止时间） | final-cycle |
| 最新受影响组合 | 退出0，18测试文件；完整文件清单另存JSON | final-affected、final-affected-files.json |
| 1A活动/冲突 | 局部79/79子测试；现代入口7/7；旧问答3/3 | 1A-status、1a-entry-conflict-green、review |
| 历史入口审查修复 | 旧失败→通过，1子测试含6种日期表达 | review-history-red/green |
| 周期审查修复 | 旧失败→5/5通过 | review.md列明日志 |
| 桌宠/食物/解析目标回归 | 退出0，8文件；补2文件退出0 | 1d-final-focused、1d-final-closure |
| 无生产迁移构建 | 退出0；此成功构建早于最后的审查/桌面定位改动，最终改动后重构建调用被中断 | final-build-dev；不能标最终产物验收完成 |
| 浏览器1B/C | 当时版本退出0，桌面/手机视口 | 1bc-browser-history、截图 |
| 最新完整1E/1D | **未通过/未完成最终复跑**，详见1E-status | 1e-browser-final、1d-browser-final、browser-current |
| diff空白检查 | 退出0 | final-diff-check.exit |
| 完整源码包 | 每包≤15MB、ZIP CRC与逐文件还原校验 | PACKAGES.json、FILES.json、delivery-verify.json |

## 五组原有失败

本轮逐组重新执行，未改断言掩盖，也未为了测试注入私人V4。详尽根因与日志见2-3-status：

- training-redesign：3通过/1失败，旧角色参考文案预期。
- warmup-workflow：3通过/1失败，旧male-front.webp资源路径预期。
- character/integration：4通过/2失败，旧角色计数100及female-front.webp预期。
- coach-training-mechanisms：9通过/5失败，旧“结论：”首句约定；部分后续规则仍需专业复核。
- plan400-components-store：2通过/3失败，依赖私人V4自动注入，与FK_NO_TEST_PLAN隔离冲突；应另用显式合成夹具，未恢复私人课表。

没有宣称全仓测试全绿。没有真实模型、真实token/延迟/费用、生产SQL、真实品牌设备、独立盲题、真机或专业效果验收。开发反例不是独立冻结测试集。
