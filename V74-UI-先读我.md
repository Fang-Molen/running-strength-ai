# 方坤 V74 UI 集成候选 · 2026-10-17

这是在用户最新 V74 设计上完善的独立源码候选，供 Grok Bot 本地部署与复验；没有发布，也没有更改手机上正在使用的 V70。

先读 [本轮交付说明](docs/v74-ui-20261017/Codex-交付说明.md) 和 [失败与修复记录](docs/v74-ui-20261017/合并与失败修复记录.md)。以本轮验收结果和日志为准，其他历史交接文档中的版本号、测试数字不代表本轮。

## 还原源码

下载本轮全部 `fk-v74-ui-code-*.zip` 与 `fk-v74-ui-resources-*.zip`，解压至同一个空目录，合并 `source/`。这些是普通 ZIP，不是需改名拼接的二进制分卷。每个 ZIP 小于 8 MB。不要混入最初上传的另一分支 V74 或以前的 R4 资源分包。

交付根目录 `source-manifest.json` 给出每个文件的 SHA-256；`checksums.json` 给出各 ZIP 的校验和。`change-manifest.json` 为本轮修改/新增文件清单。

## 给 Grok 的集成约束

- 当前 UI、动作入口、饮食与健康页面以此候选和截图为准，勿重新生成或替换人物插画。
- 保留现有 R4 安全修复、事实层、更正、训练历史、运动员隔离和能力图事实边界。不要把 UI 分支较旧的教练代码重新覆盖回来。
- `public/demo3d/models/athlete-male.glb` / `athlete-female.glb` 是配套通用参考模型，和动作演示共用骨架、服装及光照；不是用户扫描或已还原的原设计脸型。
- 动作参数及热身模板仍是待个人确认的参考。浏览动作或调整外形不得自动修改正式训练计划或健康记录。
- 先独立部署测试，不直接覆盖用户当前版本；本轮没有授权发布。实际升级前保留原 App 导出的用户备份，不清理原站点 localStorage/IndexedDB。
- 不需要云端模型即可完成基础复盘。本轮没有调用付费模型，也没有测试真实健康/GPS 数据。

## 本地复验入口

使用 Node 24 和本包锁文件安装依赖。执行 `npm run typecheck`、`npm test`、`npm run build`。补充的 V74 测试文件列表与命令见日志包 `full-scope.json`，该列表覆盖 npm test 尚未列入的测试，不能漏跑后只报告 npm test。

真实浏览器脚本：`scripts/ui-v74-functional.mjs`、`scripts/ui-v74-schedule.mjs`、`scripts/health-v74-browser.mjs`。默认使用本地合成数据；可传入独立本地预览地址。它们不连接任何外部模型，屏蔽非本地请求。脚本的服务器启动、截图路径及 Chromium 路径需按 Grok 本机环境设置。

需要回退时，把本轮所有 rollback 包解压到同一目录，由开发者先执行 `python rollback/restore.py <source目录>` 进行只读校验，确认适用后加 `--apply`。它拒绝覆盖交付后被修改的文件，仅回退源码，不读取或更改浏览器训练与健康数据。完整原始回退包仍留在 Codex 工作副本中。
