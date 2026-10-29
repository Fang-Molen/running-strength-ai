# 方坤回答校验与关卡完善包 V1
日期：2026-10-29。用途：先完成校验设计、验收题和可运行的离线检查工具，再交 Codex 集成到实际项目。

**已完成：源码缺陷定位、分层关卡设计、实施任务、验收场景、评估工具及本包自检。尚未完成：App 实现、真实模型新复测、浏览器/手机验证、专业审核。**
这不是“方坤已经修好”的交付包；不包含全量项目或密钥，不花费新的模型额度。它是 V3 全能力测评和完整复测独立审计的专项补充，不替代二者。

阅读顺序：
1. 01_校验设计与决策规则.md
2. 02_Codex执行任务.md（可直接交给 Codex）
3. 03_验收与评分.md
4. 04_复盘与剩余风险.md
5. candidate/cases.jsonl：候选系统可见的输入；reviewer/rubrics.jsonl：仅评审侧可见的要求
6. tools/ 与 verification/：离线工具及本次实际运行结果
7. evidence/：旧源码计算缺陷复现、旧回复节选及来源说明

使用：
```bash
python3 tools/gate_eval.py lint
python3 -m unittest discover -s tools -p 'test_*.py' -v
python3 tools/gate_eval.py template --out /tmp/fangkun-gate-results.jsonl
python3 tools/gate_eval.py evaluate --results /tmp/fangkun-gate-results.jsonl --out /tmp/fangkun-gate-report.json
node evidence/repro/reproduce.mjs
```
template 生成的结果全部是待测，evaluate 应返回非零并报告待测，绝不能用它冒充方坤成绩。工具只审核结果契约和已有评审记录，不自行理解中文回答是否专业正确。语义评审需要真实输出、逐条原文证据和独立审核。证据复现脚本会重写 evidence/repro/observed.json；报告的是旧缺陷仍可复现，不是修复通过。

交回要求：一个 ZIP，包含补丁/变更源码、基线与最终提交、逐题最终回答、所有尝试的用量、回归结果、未完成项。本包无需重新打包原图片、模型及无关素材。

