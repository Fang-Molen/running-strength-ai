> 2026-10-29 最新：34轮+6会话真实测量已跑完，未全部通过。本次续测54次/184,405 tokens，正式回归50/50已封顶。逐轮结果、保存回复复验与剩余缺陷见 [completion-run/SUMMARY.md](verification/new-questions-20261029/completion-run/SUMMARY.md)。不得继续付费重跑或把工程接受等同语义/专业通过。

# 方坤测试接手入口

目标仓库：`Fang-Molen/running-strength-ai`。目标分支：`test/load-memory-20261029`。
这是保留现有开发进度的交接快照，不是“所有功能已验收”的发布版本。

## 先执行

```bash
git clone --branch test/load-memory-20261029 https://github.com/Fang-Molen/running-strength-ai.git
cd running-strength-ai
git rev-parse HEAD
python3 verification/load-memory-20261029/check-test-workspace.py
python3 verification/new-questions-20261029/prepare.py
npm ci
npm run typecheck
python3 verification/load-memory-20261029/run-targeted.py
```

使用 Node.js 24（本轮为24.19）及 Python 3。源码检查应返回 `readyToTestThisSnapshot=true`；题包检查只验证输入文件及算术，不运行模型。不要把题包校验通过视为回答质量通过。

启动本地页面用 `sh startup.sh`，其内部通过 `npm run dev` 启动。需要构建时使用 `npm run build:dev`；**不要运行 `npm run build`，它包含数据库迁移**。浏览器验收沿用现有合成场景，不能清理或连接用户真实数据。

## 目录与数据

- `src/`、`server/`、`api/`、`functions/`、`scripts/`、`native/`、`public/`：完整现有代码与资源，保留原基线历史。
- `docs/load-memory-20261029/`：当前任务、执行计划、研究及验收材料。
- `verification/load-memory-20261029/`、`verification/phased-plan-20261028/`：回归脚本、既往通过与失败日志；具体结论须看最后一次运行，不按文件名自动判定。
- `verification/new-questions-20261029/`：新测试准备脚本、调度顺序、`RESULTS.jsonl`、`TOKEN.csv`、`SUMMARY.md`。
- `verification/new-questions-20261029/input-package/`：用户上传的新题 ZIP 的完整解压内容（7个文件，含原清单），可独立复验哈希。
- `handoff/20261029/`：两个已保存的累计交接 ZIP 及校验和。它们保留各自制作时的状态；当前分支文件更新，**不要再用旧 ZIP 覆盖本分支**。
- `verification/repository-handoff-20261029/`：本次交接的敏感内容扫描与验证记录。

依赖目录、构建缓存、进程PID、运行时日志、密钥和 `.env` 不作为源代码交付。原始工作区保留，不重置。

## 当前真实状态

相关负荷/记忆回归此前为34个文件、318项通过；本次交接会再次运行并保存报告。全仓仍有旧基线失败，见 `docs/phased-plan-20261028/verification-summary.md`。浏览器完整闭环尚未验收；不要用旧PASS文件或截图补齐未测项。

新题32条独立路径共34轮对话，长历史为6个独立模式对照会话；真实模型调用0次。结果文件中的 `NOT_RUN` 和用量 `NA` 必须保留至真实执行。尚需完成隔离事实库导入适配器、App/HTTP假模型联调、真实模型执行和评分；不是配置密钥后已有一键全量测试脚本。

## DeepSeek 与权限

用户已授权本次合成测试使用 DeepSeek 并产生费用。仅使用题包的 SYN-A/SYN-B 合成数据，评分参考 `02_评测参考_勿传方坤.jsonl` 永不传给被测模型。

当前实例没有 `DEEPSEEK_API_KEY`。新环境须在环境配置中声明同名环境变量需求，从用户 Personal vault 取得值；仅存在于 vault 且“适用于所有环境”不足以注入。只检查变量存在与长度，不输出值。API模型、费用上限、请求配置与真实usage应单独记录；不能把假模型使用量当真实Token。

用户仅授权此次提交推送到本测试分支。不得推到main/release、合并、开PR、发布、部署或迁移生产库。真实模型未运行、未取得独立专业复核，不能声称专业能力认证通过。
