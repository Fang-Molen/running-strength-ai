# 方坤当前交付入口 · 2026-10-28

最新用户约定（2026-10-29）：只需GPT Work交接，不必再发全量源码。先读CURRENT-TASK.md；下方全量包信息仅为已保留的历史交付说明。

从本页接续，不重做或重套旧补丁。用户提供的原任务规格保持在本目录，当前实现与证据以本页及对应状态报告为准。

源码来自 `Fang-Molen/fangkun` 的 `codex/coaching-repairs-20261028`，已用 Git 核对完整基线 **92632540c8cd42267461d42403786bec2a2281eb**。本地目录 `/workspace/fangkun-20261028`，当前分支 `codex/phased-plan-local-20261028`。本轮改动未提交、未推送；最终文件内容由交付 `FILES.json` 的逐文件 SHA-256 确定，不冒称有新提交。

**当前状态：本地修复与可运行回归已保存，整个分阶段计划仍部分完成。最终1D/1E浏览器、最终产物复验及批量饮食等剩余项见1E-status和1D-status；不要把分包交付等同全功能验收。**

## 阅读顺序

1. `CURRENT-TASK.md`：当前进度与下一步。
2. `verification-summary.md`：本轮最终命令、结果与已知失败。
3. `1A-status.md`、`1BC-status.md`、`1D-status.md`、`1E-status.md`：第一批实际修改及验收。
4. `2-3-status.md`、`review.md`、`coverage-54.md`、`gaps.md`：后续本地修复、独立审查、54项映射及未验边界。
5. 只有需要查要求时再读 `01_产品主规格.md`、`02_Codex_分批执行.md`；历史审计按问题检索。

## 完整源码还原与运行

交付目录 `/workspace/fangkun-delivery-phased-20261028` 包含编号 `fangkun-full-XX.zip`、`PACKAGES.json`、`FILES.json`、`SHA256SUMS.txt` 和下载索引。每包不超过15,000,000字节。它们是完整源码与必要资源分组，不依赖旧基线，也不是二进制分卷；将所有ZIP解压到同一新空目录，得到 `fangkun/`。不要覆盖已有项目或真实用户数据。

先核验 `sha256sum -c SHA256SUMS.txt`，再按 `FILES.json` 核对还原文件。安装：`npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/fangkun-npm-cache`。环境实际 Node24.19.0/npm11.9.0，锁文件未改。

本地合成验证设置 `FK_NO_TEST_PLAN=1`。类型检查 `npm run typecheck`；核心回归 `npm run test:coach-qa` 与 `npm run test:cycle`；安全构建 `npm run build:dev`。**不要运行 `npm run build`，它含数据库迁移。** 构建/测试时清除生产数据库及模型凭据。预览用 `sh startup.sh`，启动 npm 包装脚本并监听8080；工作区平台入口另保留 `/workspace/startup.sh`。

本轮浏览器脚本 `verification/phased-plan-20261028/run-browser.py` 依赖本地8080、Chromium和Playwright，自动启动8095的隔离假后端；不调用真实模型。脚本中的 synthetic 身份及测试签名只供本地夹具。

## 保留与回退

原记录、私人V4及未提交成果未清空。用户上传的两份 panel-fixture 已比较后恢复；旧预览日志/Python缓存没有迁回，不声称已恢复原浏览器存储。测试仅创建合成数据，没有连接真实账号或生产库。

交付排除 `.git`、依赖、构建输出、缓存、私人课表夹具以及未做隐私复核的历史验收日志/截图；完整公开应用源码及必要资源保留，排除项逐项见PACKAGES.json。私人数据仍保留在原工作区，不进入分发包。历史文档仅作历史参考。

如需回退本轮代码，在另一新目录取得基线9263254并比较当前文件清单；保留当前目录和数据。不要对含未提交成果的目录执行强制重置或清理。

未推送、合并、部署、迁移生产库、访问真实设备账号或付费调用。真实模型/食物源/品牌设备、真机、专业审查及长期效果没有验收；历史费用仍未知。
