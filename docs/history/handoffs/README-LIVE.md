# v73 当前交接状态（2026-10-17）

联网识图与交互修复已完成源码集成，见 V73-HANDOFF.md / CODEX-TASK-V73.txt。999项测试、类型检查、构建通过；真实API、原Pages部署、Safari/iPhone实测尚未执行。新增的 functions/api/vision.js 需随原项目部署并配置服务端DeepSeek密钥及识别访问码。

v73继承v72热身与通用人物成果，原精细定制人物仍未完成。与线上最新工作做差异合并，不覆盖另一分支的教练逻辑。

---
以下为v72及更早的历史交接记录，当前状态以上述v73说明为准。

# v72 热身与体型3D接入候选，尚未上线

先读 V72-HANDOFF.md。本版热身设置、执行计时、暂停恢复、逐项实际记录和同课主训练关联已接入；健康页已接可调体型3D参考。979项测试、类型检查、生产构建通过。未进行浏览器、Safari/PWA或iPhone真机验收。

原设计人物的脸型、写实发型、独立宽松服装和白鞋尚未完成；当前角色是可真实形变的通用3D，不是原立绘人物的完成版。当前/目标外形为手动视觉参考，不是56kg/60kg的身体预测。

此前 fangkun-v72-codex-handoff.zip 是开发中快照，本次完成接入的源码包取代它。原v71交接说明仅作为历史记录。继续使用原 molen-fangkun.pages.dev 项目。

---

# 方坤 测试版 · 正式基线（canonical）

线上：https://molen-fangkun.pages.dev  （Cloudflare Pages 项目 molen-fangkun，生产分支 main）
基线 tag：`live-baseline-20261016`。以后所有方坤更新都在本目录改，不再从其它 fangkun-* 目录部署。

## 内容
- 6 个标签：今日 / 计划 / 日志 / 方坤β（本地规则引擎，测试版）/ 健康 / 饮食
- 方坤：本地规则引擎为主；静态部署没有服务端模型函数，所以**不会把任何数据发给 DeepSeek**。以后接 DeepSeek 必须走服务端代理（密钥做 Cloudflare secret），发送前去标识化并先征得用户同意。
- 方坤回答下有「反馈/报错」→ localStorage `fk-feedback-v1`（同步镜像到 IndexedDB），可导出 JSON。
- 训练计划（v89.6 起）：应用不内置任何计划。计划是数据，用「导入计划/备份文件」导入（格式 fangkun-plan-v1，存 `fk-plan-doc-v1`，上一版 `fk-plan-doc-prev-v1`），读写见 `src/lib/plan/active-plan.ts` / `plan-import.ts`；组件 `src/components/plan400.tsx`（没有计划时显示「未导入计划」）。用户本人的 400 计划只作测试夹具在 `test-fixtures/private/`（含原 PDF 与解析脚本），不进包、不进精简源码。记录仍存 `fk-plan400-v4-log`（key 不变）。
- 佳明账号同步：`functions/api/garmin/[[path]].js`（复用 molen-garmin 中转）。登录后令牌用 AES-GCM（secret `STATE_KEY`）加密，放在 HttpOnly+Secure+SameSite=Strict cookie（Path=/api/garmin，180 天），前端 JS 读不到；令牌快过期时服务端自动刷新；无日志、不存储密码。前端组件 `src/components/garmin-sync.tsx`：活动（最近 60 条）+ 14 天 RHR/HRV/睡眠/身体电量/压力 → `saveDeviceRows` 去重写入。

## 数据保存（src/lib/vault.ts）
- 全部用户数据（训练、计划、日志、佳明导入、方坤对话、反馈、400m 记录）在 localStorage，启动时全部镜像到 IndexedDB `fangkun-vault`（kv + meta），之后每次写入实时镜像；申请 `navigator.storage.persist()`。
- localStorage 被系统清掉时，启动自动从 IndexedDB 找回。
- `VAULT_SCHEMA` + `MIGRATIONS`：升级数据结构只追加迁移函数，不删除用户数据。
- 健康页「全部数据备份」：一键导出 / 导入恢复 / 导出反馈。
- 同一域名 molen-fangkun.pages.dev 下的数据跨版本保留；换域名需导出→导入。

## 部署 / 更新
本包为源码交接，不包含发布凭据，也没有执行部署。先在现有工程的独立工作分支合并并核对差异，再运行：

```bash
npm ci
npm test
npm run typecheck
npm run build
```

构建必须正常退出，不忽略SSR错误，不移动PWA/品牌中间件。静态输出为 `.output/public`，保留项目根目录 `functions/` 及构建复制的 `_headers`，沿用原项目的SPA路由回退配置。不要用旧说明里的单行文件覆盖完整响应头。

由有原项目权限的发布环境沿用现有 Cloudflare Pages 流程发布；项目名仍是 `molen-fangkun`，域名仍是 `molen-fangkun.pages.dev`。发布前备份、保留线上最新差异；发布后核对动态模块、Garmin、缓存切换与手机关键流程。代码测试通过不等同于手机验收通过。
构建为 SPA 静态（vite.config.ts：tanstackStart spa + nitro preset static），Functions 目录随部署上传。Service worker 自动更新并刷新一次（训练进行中不刷新）。

## 数据延续到正式版（必须遵守）
- **以后所有版本都部署到同一个 Pages 项目 / 域名 `molen-fangkun.pages.dev`**（数据跟着域名走，IndexedDB/localStorage 不跨域名）。不要新建项目或换域名；要换的话，先让用户导出再导入。
- 不要改已有的存储键名，也不要删除；结构要变就在 `src/lib/vault.ts` 的 `MIGRATIONS` 里加 `VAULT_SCHEMA+1` 的迁移，只追加、只补字段。
- `src/lib/vault-migration.test.ts` 用测试版数据快照（`src/lib/__fixtures__/vault-beta1-snapshot.json`）验证升级后键和值都还在。新版本发布前必须通过；有新的存储键就把它加进 fixture。
- IndexedDB `fangkun-vault` 版本 2：`kv`（实时镜像）、`meta`（schema、lastSync）、`snapshots`（每天自动快照，保留最近 7 份，健康页可恢复）。
- 大版本发布时把 `APP_MAJOR` 改掉 → 健康页提醒用户先导出备份（14 天没导出也会提醒）。
- 改动都记在 `CHANGELOG-user.md`。
