# BUILD 34 — 错误案例回归与学习合同

在 BUILD 33 安全分流模块副本上修复历史症状、局部否定、红/茶/可乐色尿表达。保存原始500题结果与修复后结果、20个新增挑战样例。未更改完整 App 的任何文件，未集成生产知识库。

运行 `node --experimental-strip-types run-500.mjs` 与 `node --experimental-strip-types heldout.test.mjs`。通过仅代表预设标签匹配；20题已用于修复，不能再作为独立测试。医疗安全标签未经临床专家审核，尤其“已缓解晕厥/胸痛”应按实际临床背景进一步评估。

未执行完整 App typecheck/build、真实聊天端到端、iPhone 测试。没有自动学习或微调模型权重；没有解冻计划修改权限、发布或改动用户数据。
