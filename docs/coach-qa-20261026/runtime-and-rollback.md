# 运行配置与回滚

本次不部署。现有站点仍是 `https://molen-fangkun.pages.dev`，不另建前端、不替换用户域名。只读现场证据见 `verification/coach-qa-20261026/live-read-only.json`：站点报告 V89.11.1，教练 API 与 auth GET 当时均返回 HTML。配置检查成功只说明配置齐备，不证明 DeepSeek 实际连接、余额或专业能力。

## 两种构建

- `npm run build`：保留原静态输出 `.output/public`。静态文件不执行 TanStack 服务端路由。
- `npm run build:server`：显式 Node 服务输出，`npm run start:server` 启动 `.output/server/index.mjs`。构建过程不自动应用教练数据库迁移。
- 本次锁文件未改；实际验证环境 Node 24.19.0、npm 11.9.0。不能把此结果当作平台 Node 22 的独立验收。

在用户批准发布后，管理员可将现有 Cloudflare Pages 的 `functions/` 一并发布，并连接经过配置的 Node 后端。选其一：

1. Cloudflare service binding `FANGKUN_COACH_BACKEND`，保持原请求 URL、Origin 与认证凭据。
2. 固定 HTTPS `FANGKUN_COACH_BACKEND_ORIGIN` 和至少32字符的服务端 `FANGKUN_COACH_PROXY_SECRET`。Node 端配置同一密钥及 `FANGKUN_COACH_PUBLIC_ORIGIN=https://molen-fangkun.pages.dev`。客户端 JSON 不能选择上游地址；不跟随携带凭据的重定向。

同源转接包括 `/api/coach-chat`、`/api/coach-snapshot`、`/api/auth/*`。已有应用的认证回调、cookie、公共 origin 必须一致。认证回调的安全302与Set-Cookie原样转给浏览器；如认证起点需要重定向至发行方，在Pages配置相同的 `GROK_AUTH_ISSUER` HTTPS来源。教练JSON接口仍拒绝重定向。服务端保留原有 Better Auth session／受签名 gate 身份核验；不接受浏览器传入的用户 ID 或 dev-user。

## 启用条件

生产默认关闭。以下均需管理员真实配置，不能复制测试 harness 的合成配置：

- 构建与运行的 `VITE_AUTH_ENABLED=true`；现有 Better Auth 服务的稳定 `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL` 与其真实登录提供方配置（既有 `GROK_AUTH_*`，或既有可信 gate 配置）。
- `DATABASE_URL` 指向同一个持久 PostgreSQL。先审核并应用 `migrations/coach/001_deepseek_budget.sql` 与 `002_coach_snapshots.sql`，以及既有认证所需的 schema，随后设置 `FANGKUN_COACH_SCHEMA_READY=true`。本次没有连接或修改生产数据库。
- 历史费用在其他环境仍待核对。必须完成账本导入／对账与未决预约处理，才可设置 `FANGKUN_COACH_LEDGER_RECONCILED=true`。空表不表示历史费用为零。
- `DEEPSEEK_API_KEY` 仅留服务端。`FANGKUN_DEEPSEEK_POLICY_JSON` 遵循 `server/coach-deepseek/lib/coach-service-contract.ts` 的 `VerifiedDeepSeekPolicy`：实际核验的模型、价格版本、有效期、token／缓存计费规则与预算。没有核验不能将各 verified 字段直接设为 true。
- 最后显式设置 `FANGKUN_DEEPSEEK_ENABLED=true`。状态 GET 不连接模型、不读取训练资料、不收费。

仍需用户另行批准的真实付费验证：部署后的真实登录／退出、当前域名 cookie 与代理、真实数据库实例、DeepSeek 实际输出与计费。当前工程与替身测试不能代替这些验证。

## 数据与授权边界

前端展示并逐次同意后，才上传问题及近14天最多6条人工／应用记录中的受支持标量。设备明细、训练分段、力量组次、饮食与正式课表不在这个最小联网适配范围，仍留在本地分析中。界面列明省略范围，不能把未发送的数据解释为不存在。

所有上传标量均标为 USER_DECLARED；服务器核对身份、归属、版本、单位、时间、同意范围，未冒充设备或实验室验真。快照不可变、有效10分钟；新版使旧版失效；请求结束尝试撤回。断网时不能承诺立即完成远端撤回，服务器过期机制仍有效。取消或数据／身份变化后不显示旧回答；已经派发的请求不能宣称免费，未知计费保留待核。

持久费用账本先预留、派发后结算，重复 requestId 不重复派发；不明使用量进入 UNKNOWN，不能按零结算。模型从未拥有正式课表或身体记录的写入权限。

## 回滚

合并前：关闭本 PR 即可，现有主线与部署未改变。

若将来合并后需要回滚：先关闭 `FANGKUN_DEEPSEEK_ENABLED`，再撤回本 PR 的代码提交，恢复原静态构建与既有部署。保留新增授权表和费用账本，特别是 DISPATCHED／UNKNOWN 记录；不执行 DROP、TRUNCATE 或清空用户数据。独立分支基线为 `1d57de0d413f365ff3ece4b63f859f94298706ba`。
