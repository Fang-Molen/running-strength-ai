# 缺陷与能力清单对照

依据：用户2026-10-29消息DS-01～DS-06，以及上传整合包03文档0A/7.1A。未把仓库旧清单冒充其他置顶聊天。整合包题面、参考和历史文件与仓库原版逐字一致。

| 来源/要求 | 本次对应证据 | 结论/未完成 |
|---|---|---|
| DS-01 截断/空正文/JSON | calls.jsonl每请求finish=stop、payload max_tokens=1800、thinking disabled；reply schema继续严格拒绝残JSON | 11次完整JSON；不能据小样本称普遍消除截断 |
| DS-02 数学/来源 | question-calculation.test.ts使用变值非题号匹配；原参考未更改；Q01-B复算1200/314 | 数学已回显，计划数字换述误拒仍阻断 |
| DS-03 入库至输出逐层 | import-receipt.json、full-offline.jsonl、offline-payloads.jsonl、run.ts实际App session与HTTP；短日期和近期范围反例 | 离线请求含关键课和反馈；真实历史与完整产品导入/浏览器未测 |
| DS-04 原3组 | 原dispatch-order/245行不改，FINAL-CAMPAIGN-NOT-RUN.jsonl保留全部40轮分母 | 新3对未执行，不覆盖旧0/3 |
| DS-05 可理解与专业审查 | Q15每次最终显示与原始回复分开保存；引用原子性、标题和列表清理 | Q15末次仍失败；Q08缺独立专业评审 |
| DS-06 usage | TOKEN.csv逐请求输入/输出/缓存；推理细分缺失NA，账单NA | 11次共9971，含全部失败/显式重测 |
| 仓库 capability-gaps：模型没收到 | 源码contextModelQuote、online-context及原始请求 | 仅本次合成入口及预算范围，非全部App场景 |
| 仓库 capability-gaps：计划/实际、更正 | 变值算术、会话用户自述来源、只读planChanged=false、客户端二次校验 | 本轮Q11真人/真模型更正未做；源回归通过不能替代实测 |
| coverage-54 / phased-plan/gaps：跨账户、备份、设备、营养、长期训练 | 沿用现有回归及缺口文档 | 不扩大到生产恢复、真实品牌/真机或真人长期验证；未据本轮宣称54项全部通过 |

预算与停测：本轮9次冒烟+2次定向=11；自动重试0，显式多次尝试均独立计数。原计划同版本全量40轮0次运行，50次全量上限没有触及；停止原因为语义质量门槛失败。没有以关闭拒绝或删除原题制造放行。
