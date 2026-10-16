# 方坤 测试版 · 正式基线（canonical）

线上：https://molen-fangkun.pages.dev  （Cloudflare Pages 项目 molen-fangkun，生产分支 main）
基线 tag：`live-baseline-20261016`。以后所有方坤更新都在本目录改，不再从其它 fangkun-* 目录部署。

## 内容
- 6 个标签：今日 / 计划 / 日志 / 方坤β（本地规则引擎，测试版）/ 健康 / 饮食
- 方坤：本地规则引擎为主；静态部署没有服务端模型函数，所以**不会把任何数据发给 DeepSeek**。以后接 DeepSeek 必须走服务端代理（密钥做 Cloudflare secret），发送前去标识化并先征得用户同意。
- 方坤回答下有「反馈/报错」→ localStorage `fk-feedback-v1`（同步镜像到 IndexedDB），可导出 JSON。
- 400m 计划：`src/lib/plan400-v4.json`（由 docs/plan400/parse.py 从 PDF 逐字解析，70 天课 + 最终测试，整体顺延 7 天），组件 `src/components/plan400.tsx`，记录存 `fk-plan400-v4-log`（按日期：完成/减量/取消、实际分段、休息、辅助、力量组×重量×次数、RPE、疼痛、24h、48–72h、备注）。
- 佳明账号同步：`functions/api/garmin/[[path]].js`（复用 molen-garmin 中转）。登录后令牌用 AES-GCM（secret `STATE_KEY`）加密，放在 HttpOnly+Secure+SameSite=Strict cookie（Path=/api/garmin，180 天），前端 JS 读不到；令牌快过期时服务端自动刷新；无日志、不存储密码。前端组件 `src/components/garmin-sync.tsx`：活动（最近 60 条）+ 14 天 RHR/HRV/睡眠/身体电量/压力 → `saveDeviceRows` 去重写入。

## 数据保存（src/lib/vault.ts）
- 全部用户数据（训练、计划、日志、佳明导入、方坤对话、反馈、400m 记录）在 localStorage，启动时全部镜像到 IndexedDB `fangkun-vault`（kv + meta），之后每次写入实时镜像；申请 `navigator.storage.persist()`。
- localStorage 被系统清掉时，启动自动从 IndexedDB 找回。
- `VAULT_SCHEMA` + `MIGRATIONS`：升级数据结构只追加迁移函数，不删除用户数据。
- 健康页「全部数据备份」：一键导出 / 导入恢复 / 导出反馈。
- 同一域名 molen-fangkun.pages.dev 下的数据跨版本保留；换域名需导出→导入。

## 部署 / 更新
```bash
export PATH=/home/box/.local/node22/bin:$PATH
npm ci && npm test                      # 必须全绿
# 改前端：public/sw.js 的 CACHE 版本 +1（同时改 scripts/sw-migration.test.mjs 里的名字）
mv server/middleware/grok-pwa.ts /tmp/ && rm -rf .output && npx vite build; mv /tmp/grok-pwa.ts server/middleware/
#  （vite build 结尾的 "SSR entry" 报错可忽略，只要 .output/public/index.html 已生成）
printf '/* /index.html 200\n' > .output/public/_redirects
printf '/sw.js\n  Cache-Control: no-cache\n' > .output/public/_headers
npx wrangler pages deploy .output/public --project-name molen-fangkun --branch main --commit-dirty=true
git commit -am "..." && git tag live-YYYYMMDD
```
构建为 SPA 静态（vite.config.ts：tanstackStart spa + nitro preset static），Functions 目录随部署上传。Service worker 自动更新并刷新一次（训练进行中不刷新）。
