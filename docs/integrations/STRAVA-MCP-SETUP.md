# 方坤 Strava 个人 MCP 接入说明

适用版本：v89.10.7。公开文档与未登录元数据核验日期：2026-10-22。

## 当前实现的范围

统一「设备与数据同步」窗口提供 Strava 个人接入码、同页官方 OAuth 授权、连接状态、官方 MCP 能力核验和断开操作。能力核验只发送 MCP `initialize`、`notifications/initialized` 和分页 `tools/list`，返回工具名称及厂商提供的 `readOnlyHint`。没有调用 `tools/call`，没有读取真实活动、个人档案或健康记录，也没有将 Strava 数据导入方坤训练库。

`connected:true` 表示服务端可验证本地保存的授权凭证及个人接入门禁；这不是刚刚在线验证过订阅、账户身份或同步过活动的证明。`accountRef` 保持 `null`，`dataImported` 始终为 `false`。工具的 `readOnlyHint:null` 表示厂商未说明；外层 `readOnly:true` 描述本模块只发现工具，不表示所有上游工具都只读。

Strava 2026 API 政策 §3.5 为订阅者本人使用自己的 AI 应用保留个人 MCP 用途，并限制开发者个人之外的商业和第三方使用。部署者需要核对自身用途与当时的 Strava 条款。本模块不以普通 REST API 作为 AI 或训练数据导入的替代路径，不向公共访客开放连接，也不构成对第三方使用的许可。

## 服务端配置

四项配置必须同时存在；全部只在服务器环境中读取，不使用 `VITE_` 前缀，不写入前端构建或浏览器存储。

| 环境变量 | 要求与作用 |
| --- | --- |
| `STATE_KEY` | 非空的服务端加密密钥。建议使用至少 32 字符的高熵随机值，通过部署平台的 secret 管理保存。 |
| `STRAVA_MCP_PERSONAL_USE` | 必须精确为 `true`，显式启用个人用途。 |
| `STRAVA_MCP_PERSONAL_OWNER` | 唯一允许的方坤 athlete ID，例如当前本地默认档案的 `local`；不能为空或 `*`。 |
| `STRAVA_MCP_PERSONAL_ACCESS_KEY` | 至少 32 字符的独立个人接入码，建议高熵随机生成。由本人在统一窗口的密码输入框中填写。 |

浏览器上报的 athlete ID 不是可信身份，不能单靠它限制私人接入。模块额外要求个人接入码，比较通过后才签发加密、`HttpOnly; Secure; SameSite=Lax` 的个人门禁 cookie。输入框提交时立即清空，接入码不写入 localStorage 或 sessionStorage。服务器不会在错误或状态响应中回显输入。

缺少配置时，状态为 `PERSONAL_SETUP_REQUIRED`，不会发起动态客户端注册。配置齐全但个人门禁未解锁时，状态为 `PERSONAL_ACCESS_REQUIRED`。所有者不匹配时拒绝访问。个人门禁有效期 20 分钟；过期后重新输入接入码，仍需核验当前保存的授权状态。

生产部署必须使用 HTTPS。不要通过更改 cookie 安全属性来使真实账户授权在不安全的 HTTP 站点运行。此轮本地 UI 验证使用了完全拦截的模拟 API，没有执行真实 OAuth。

## 路由与回跳

将下面的相对路径部署在前端相同的站点 origin：

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/strava-mcp/status?athlete=<id>` | 返回配置、门禁和已保存授权状态；不访问上游。 |
| `POST /api/strava-mcp/unlock?athlete=<id>` | JSON `{ "accessKey": "本人配置的接入码" }`；成功后写入短期门禁 cookie。 |
| `GET /api/strava-mcp/start?athlete=<id>` | 本人点击连接后发现元数据、必要时注册客户端，再以 HTTP 302 跳转到官方授权页。 |
| `GET /api/strava-mcp/callback` | 接收官方 OAuth 回调；固定返回 `/?watch_provider=strava&watch_auth=<结果>`。 |
| `GET /api/strava-mcp/capabilities?athlete=<id>` | 只核验 MCP 工具列表。 |
| `POST /api/strava-mcp/disconnect?athlete=<id>` | 取消本实例中的旧授权作业，尝试官方撤销，清除本地授权和 pending cookie。 |

动态注册的 redirect URI 固定为实际站点 origin 加 `/api/strava-mcp/callback`，例如 `https://your-own-domain.example/api/strava-mcp/callback`。没有任意 `returnUrl` 参数，官方授权使用当前浏览器页面，不调用 `window.open`。

Cloudflare Pages 适配器为 `functions/api/strava-mcp/[[path]].js` 的 `onRequest`。Vercel 适配器为 `api/strava-mcp/[...path].ts` 的命名 `GET`/`POST` Web Handler，使用默认 Node.js runtime；当前官方文档已将 standalone Edge Functions 标为弃用，因此此适配器不设置 `runtime:'edge'`。两种适配器只显式读取上述四个服务器环境变量，没有暴露整个环境对象。

## 官方发现与尚未验证的部分

未登录公开发现得到以下端点：

- 资源元数据：`https://mcp.strava.com/.well-known/oauth-protected-resource`
- MCP 资源：`https://mcp.strava.com/mcp`
- 授权服务器标识：`https://www.strava.com/mcp-issuer`
- 授权服务器元数据：`https://www.strava.com/.well-known/oauth-authorization-server/mcp-issuer`
- 授权：`https://www.strava.com/oauth/mcp/authorize`
- 换取／刷新凭证：`https://www.strava.com/oauth/mcp/token`
- 动态注册：`https://www.strava.com/oauth/mcp/register_client`
- 撤销：`https://www.strava.com/oauth/mcp/revoke`

实现使用精确端点白名单，并拒绝发现、注册、换取凭证、MCP 等接口中的非预期 HTTP 跳转。公开元数据没有声明 PKCE 支持列表或 token endpoint authentication methods。实现始终要求 S256，不降级至 plain；如果后续元数据明确不支持 S256，则停止连接。动态注册响应决定实际认证方式，仅支持 `client_secret_basic`、`client_secret_post`、`none`；缺失认证方式时按 RFC 7591 的 basic 默认值处理，所需 secret 缺失或方法未知时拒绝继续。凭据到期或 `invalid_client` 会清理客户端缓存，下一次明确点击可重新注册。

本次没有发送真实 DCR 注册 POST，没有真实用户授权、订阅、PKCE 往返、账户撤销或真实 MCP 工具 schema 的验证。公开 metadata 里的 registration endpoint 证明服务公开宣告了注册位置，不能证明某个部署域名和个人订阅一定获准。未登录的 `initialize` / `tools/list` 返回 401；因此当前没有猜测活动工具名、参数或训练库映射。部署后只有在本人明确连接成功、返回工具列表且进一步核验数据契约后，才能另行设计真实训练导入。

## 凭证、取消与并发边界

OAuth pending 状态有效期 10 分钟，绑定个人门禁 nonce、方坤 owner、origin、固定 redirect URI、PKCE verifier 和授权代际。state 在当前实例内单次消费。客户端与 token cookie 使用由 `STATE_KEY` 和个人接入码共同派生的 AES-GCM 密钥加密；token 最多四个分片 cookie，每片不超过 3400 字符。凭证与客户端缓存最长 60 天，实际令牌有效性仍取决于官方的到期和撤销状态。轮换任一服务器密钥会使已有加密 cookie 无法读取；这不等于已经在 Strava 撤销授权。

独立审查用受控的合成异步 gate 复现并修正了四个同实例窗口：

1. callback 换取凭证尚未返回时断开，迟到 callback 不得恢复 cookie 或已连接状态。
2. 已生成但尚未使用的旧 pending state，在断开后不得授权。
3. 刷新期间断开，必须对迟到的旋转凭证尝试撤销，并停止后续 MCP 请求。
4. 刷新完成、加密新 cookie 尚未完成时断开，不得在加密结束后重发有效 cookie。

当前实现用门禁 nonce 的授权代际和会话撤销标记，使旧 pending 与授权失效；活动作业持有其最新 grant，断开时尝试撤销已知最新凭证。callback 在换取凭证后和加密后再次检查；refresh 的迟到 grant 先撤销再退出；每次 MCP 请求前后及最后 cookie 加密后也检查状态。新的明确连接可以沿用仍有效的个人门禁，但必须建立新一代 pending。

每个门禁 nonce 还记录本实例当前的 pending state。新发起的连接使旧 pending 不再有效；旧、不匹配、已取消或重放的回跳不清除后来的 pending cookie。较早的 token exchange 无论成功还是拒绝，也不会清除新 pending／客户端 cookie 或写回旧凭证。当前有效的回跳仍按原行为消费 state 并清除自己的 pending cookie。相应的三条最小回归均先失败、修复后通过。

`revoked:true` 只在没有未完成作业、没有 pending 不确定性且已知凭证撤销成功时返回。上游撤销失败，或断开响应返回时仍存在可能产生新凭证的作业，返回 `revoked:false`，统一窗口保留「请到 Strava 的 My Apps 确认并撤销授权」提示。删除本机 cookie 不能表述为已经撤销厂商授权。

这些代际、重放与活动作业表都在单个进程／实例内。它们不能证明跨实例、跨区域或进程重启后具有原子撤销与重放阻断。官方授权码的一次性、加密 cookie、时效及浏览器清 cookie 仍提供正常流程约束；如果需要对公网多实例部署作出全局并发安全保证，需增加共享原子 nonce／代际／撤销存储和分布式作业协调。此版本没有实现该共享存储，也没有声称完成该保证。

## 验证记录

- `src/lib/health/strava-mcp-server.test.ts`：31 项合成服务器测试通过；其中独立审查回归先得到 4 项失败，旧回跳影响新 pending 的回归先得到 3 项失败，修复后全部通过。
- 聚焦 TypeScript 检查覆盖模块、测试和 Vercel Web Handler，通过。
- 所有服务器测试使用可注入 fetch，没有真实账号、真实凭证、真实 DCR 或厂商数据。
- 浏览器测试覆盖个人接入码清空／不落盘、同页连接链接、授权回跳、工具发现不生成导入记录、门禁过期回密码框、断开时保留上游撤销提示。浏览器 API 全部拦截，外部请求全部阻止。
- 以上结果不替代真实部署、真实订阅授权、Cloudflare/Vercel 云端部署或多实例并发验证。

## 官方参考

- [Strava API 政策](https://m.strava.com/legal/api_policy)，重点核对 §3.5 与 §5.3。
- [What is the Strava MCP Connector](https://support.strava.com/en-us/articles/15401531-what-is-the-strava-mcp-connector)。
- [Strava API and MCP FAQ](https://support.strava.com/en-us/articles/15401526-strava-api-and-mcp-faq)。
- [Strava 官方开发者社区 API FAQ](https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906)。
- [Strava 公开资源元数据](https://mcp.strava.com/.well-known/oauth-protected-resource)；[公开授权服务器元数据](https://www.strava.com/.well-known/oauth-authorization-server/mcp-issuer)。
- [MCP 2025-06-18 Authorization 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)。
- [OAuth 动态客户端注册 RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)。
- [Vercel Functions API Web Handler](https://vercel.com/docs/functions/functions-api-reference)；[Standalone Edge Functions 弃用说明](https://vercel.com/docs/functions/runtimes/edge/edge-functions)。
