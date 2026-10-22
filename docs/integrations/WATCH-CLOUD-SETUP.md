# Watch cloud connectors — v89.10.7

Reviewed on 2026-10-22. This is an implementation and synthetic-verification record, not a claim that vendor accounts, production credentials, partner approvals, or a deployed service have been verified.

## Implemented boundary

New independent files in `fangkun-ui-unified-v89.10.7`:

- `src/lib/health/cloud-types.ts` — shared status/preview contract.
- `src/lib/health/cloud-parse.ts` — pure official-schema mappings.
- `src/lib/health/cloud-providers.ts` — fixed-host provider requests and account verification.
- `src/lib/health/cloud-server.ts` — encrypted cookies, OAuth state, owner scope, HTTP boundary.
- `src/lib/health/cloud-parse.test.ts`, `cloud-providers.test.ts`, `cloud-server.test.ts` — synthetic tests.
- `functions/api/watch-cloud/[[path]].js` — Cloudflare Pages adapter.
- `api/watch-cloud/[...path].ts` — Vercel Node Web Handler adapter.

The implementation does not alter Garmin, COROS, Grok authentication, Vite, or the app's data storage. The parent integration owns UI and user-confirmed preview saving. No account registration, live OAuth, real health-data request, or model request was performed during this work.

## HTTP contract

| Method | Path | Result |
|---|---|---|
| GET | `/api/watch-cloud/status?athlete=<id>` | `{providers: CloudStatus[]}` |
| GET | `/api/watch-cloud/polar/start?athlete=<id>` | Same-tab 302 to official authorization endpoint |
| GET | `/api/watch-cloud/suunto/start?athlete=<id>` | Same-tab 302 to official authorization endpoint |
| GET | `/api/watch-cloud/:provider/callback` | Fixed relative return `/?watch_provider=...&watch_auth=...` |
| POST | `/api/watch-cloud/:provider/sync?athlete=<id>` | `{ok:true, ...CloudPreview}`, nearest 28-day window |
| POST | `/api/watch-cloud/:provider/disconnect?athlete=<id>` | `{ok:true, revoked:boolean, message?:string}` |

POST requests require an `Origin` header matching the configured public origin. Browser calls include same-origin credentials. The athlete parameter must be captured when a UI job begins; changing the selection must not retarget an in-flight result. Do not accept an arbitrary return URL.

```ts
type CloudProvider = 'polar' | 'suunto' | 'huawei'
type CloudStatus = {
  provider: CloudProvider
  configured: boolean
  connected: boolean
  accountRef: string | null
  reason?: string
}
type CloudPreview = {
  provider: CloudProvider
  accountRef: string
  fetchedAt: string
  activities: DeviceActivity[]
  health: DeviceHealthRow[]
  issues: string[]
  partial: boolean
}
```

The `accountRef` is a stable SHA-256-derived reference to the vendor-confirmed account, not the local athlete ID. Activity provenance retains the vendor record ID and a source identity such as `polar:<accountRef>:<recordId>`. The preview never returns an access token, refresh token, client secret, raw vendor profile, or raw upstream diagnostic body.

### Status reasons and messages

| Reason | Meaning / UI message |
|---|---|
| `NOT_CONFIGURED` | 尚未配置官方应用凭据和准确回调地址 |
| `APPROVAL_REQUIRED` | 华为运动健康需完成平台接入审核并核实数据权限，当前未开放云同步 |
| `OWNER_REQUIRED` | 请先选择当前运动员 |
| `NOT_CONNECTED` | 当前运动员尚未连接此平台 |
| `OWNER_MISMATCH` | 该授权属于另一个运动员，请为当前运动员单独授权 |
| `REAUTHORIZE` | 授权已失效，请重新授权 |

Request errors return `{ok:false,error:<machine code>,message:<safe Chinese text>}`. Relevant additional codes include `SCOPE_REQUIRED`, `ACCOUNT_UNVERIFIED`, `RATE_LIMITED`, `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_FORMAT`, `UPSTREAM_REDIRECT`, `UPSTREAM_TOO_LARGE`, `TOKEN_TOO_LARGE`, `CSRF_REJECTED`, `ORIGIN_MISMATCH`, `METHOD_NOT_ALLOWED`, and `SERVER_BUSY`. OAuth callback results use lower-case versions where appropriate, plus `ok`, `denied`, `state`, and `error`.

## Configuration and deployment

All values below belong only in server deployment secrets/environment. Do not place them in `VITE_*`, browser storage, client bundles, URL parameters, or the delivered example files.

| Variable | Requirement |
|---|---|
| `WATCH_CLOUD_PUBLIC_ORIGIN` | Exact HTTPS origin, e.g. `https://app.example.com`, without path/query/credentials |
| `WATCH_CLOUD_STATE_KEY` | High-entropy server secret at least 32 characters; domain-separated encryption key derivation |
| `STATE_KEY` | Existing server secret may be used as fallback, though an independent watch-cloud secret is preferable |
| `POLAR_CLIENT_ID` / `POLAR_CLIENT_SECRET` | Registered Polar AccessLink application |
| `SUUNTO_CLIENT_ID` / `SUUNTO_CLIENT_SECRET` | Approved Suunto partner OAuth client |
| `SUUNTO_SUBSCRIPTION_KEY` | Approved API product subscription key |

Register exact redirect URLs:

- `https://<deployment-host>/api/watch-cloud/polar/callback`
- `https://<deployment-host>/api/watch-cloud/suunto/callback`

`configured` is based on actual presence of syntactically valid deployment configuration, not a live probe or proof of approval. With no environment configuration, status safely returns `configured:false` and no network request occurs. Huawei always returns `configured:false` / `APPROVAL_REQUIRED`; supplying invented Huawei variables does not enable it.

Cloudflare Pages uses the `functions` adapter. `data.watchCloudConsumeState`, if provided by server middleware, is passed as the shared atomic nonce consumer. Vercel uses its separate `api` adapter and the default Node runtime, with named GET/POST exports and `config.maxDuration=60`. Vite development does not automatically host either serverless directory. Browser QA must mock these routes or explicitly run a local API adapter. No live routing/deployment claim is made.

Current Vercel primary documentation supports Web Request/Response handlers in `api/*.ts`; standalone Edge Functions are deprecated. A deployment may also set `functions["api/watch-cloud/**/*.ts"].maxDuration = 60` in `vercel.json` if it manages function duration there. That file was not changed by this connector work. Confirm the actual build's `/api/watch-cloud/*` routing before enabling production credentials.

## OAuth and data security

1. A cryptographically random state is sealed with the provider, exact origin, fixed callback, captured athlete scope, issue time, and ten-minute expiry.
2. Pending state and vendor grants use AES-GCM with a fresh 12-byte IV and provider/purpose/origin-associated data. Cookies are host-only, HttpOnly, Secure, SameSite=Lax, and restricted to `/api/watch-cloud`. Token cookies are bounded and chunked; oversized credentials fail safely.
3. Callback validation precedes token exchange. Missing, duplicate, expired, tampered, mismatched, or already-consumed state fails. OAuth error text is not echoed. Callback navigation always uses the fixed relative return path.
4. Only server-side requests exchange authorization codes with confidential client credentials. Polar account identity is checked against its token response and registered-user endpoint. Suunto account identity comes from the `user` claim of the access token delivered by its trusted TLS token endpoint; no client-supplied JWT is trusted. Refresh must retain the same vendor account reference.
5. All outbound hosts are explicit HTTPS allowlists. Credentials are never forwarded across redirects. Response bodies are bounded at 2 MiB; per-request waits are limited to 15 seconds, within a 45-second operation budget. No raw response body is logged or returned.
6. Status hides the connected account reference when the supplied athlete scope differs from the sealed owner. Sync/disconnect then fail with `OWNER_MISMATCH` before reading vendor data.

The athlete scope is a local selection boundary. It is not a substitute for authenticated server user identity or a multi-user account authorization system. Possession of the encrypted HttpOnly cookie is the session credential. This connector does not change the app's existing authentication shell.

### Distributed deployment condition

The fallback nonce-consumption map, cancelled-authorization generations, sync deduplication, and revoked-session map operate within one running process/instance. They are not claimed to provide global replay protection, a global refresh lock, or cross-instance disconnect coordination.

For a multi-instance production deployment, inject `consumeState(nonceHash, expiresAt)` backed by atomic insert-if-absent with expiry (for example a server-owned atomic Redis operation or a serialized Durable Object). Return `true` only for the first consumption. A get-then-put sequence without atomicity is insufficient. The hook receives a hashed nonce, not the OAuth token. Hook failures fail closed. Use shared session revocation/refresh coordination if the deployment needs equivalent guarantees across instances; this work does not pretend that storage has been provisioned.

The in-process guard is retained even when the hook exists. Standard vendor authorization-code single use is also retained. No published confidential-client PKCE support was found for these two flows, so an unsupported PKCE parameter is not invented and PKCE is not claimed.

Disconnect clears local encrypted credentials even if the provider cannot confirm remote revocation, in which case `revoked:false` carries an explicit message. During an in-process refresh/sync race, the job's latest grant is revoked and the late sync cannot return data or reinstall a token cookie. This is covered by a regression test.

### Callback cancellation correction

The final independent review found that consuming OAuth state did not by itself cancel an exchange already using that state. The corrected implementation records cancellation separately, using the pending state's unique value as the authorization generation and preserving that generation in the sealed session. Disconnect marks the pending generation even when its state has already been consumed. Callback checks the generation after token exchange and again after asynchronous encryption; a cancelled or expired callback cannot install credentials or report authorization success.

A grant that arrives after cancellation is sent to the provider's verified revocation endpoint. This cleanup has a separate ten-second budget, keeping the ordinary 45-second operation plus cleanup within the configured 60-second function limit. A pending/in-flight authorization makes disconnect report revocation as unconfirmed; the implementation does not promise that an unavailable vendor completed revocation.

Duplicate or incorrect-state callbacks do not clear a still-live pending cookie, so a subsequent disconnect can still identify the generation. An explicit new start cancels the old pending generation; a cancelled late callback does not clear the new pending cookie, including when its token exchange rejects and reaches the outer error handler. Pending cancellation also checks the captured athlete owner. Generation invalidation remains instance-local and is subject to the distributed deployment condition above.

## Implemented provider coverage

### Polar AccessLink v3

| Purpose | Verified request |
|---|---|
| Authorize | `GET https://flow.polar.com/oauth2/authorization` |
| Exchange | `POST https://polarremote.com/v2/oauth2/token`, HTTP Basic client credentials |
| Register / verify | `POST https://www.polaraccesslink.com/v3/users`; on 409, `GET /v3/users/{x_user_id}` and compare `polar-user-id` |
| Exercises | `GET https://www.polaraccesslink.com/v3/exercises` |
| Steps | `GET https://www.polaraccesslink.com/v3/users/activities?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| Sleep | `GET https://www.polaraccesslink.com/v3/users/sleep` |
| Nightly measurements | `GET https://www.polaraccesslink.com/v3/users/nightly-recharge` |
| Revoke | `DELETE https://www.polaraccesslink.com/v3/users/{user-id}` |

Scope: `accesslink.read_all`. Exercises are limited by Polar to uploads after client registration and within the recent 30-day availability window; the connector additionally filters start times to the nearest 28 days. An informational issue states that coverage, so an empty preview is not represented as a full historical backfill.

The parser preserves fractional ISO-duration seconds and metres. It never guesses an exercise timezone if both offset and explicit zone are absent. Sleep is a complete sum of supplied sleep-stage durations excluding awake; missing stages are not silently replaced with zero. Recharge HRV retains its RMSSD and four-hour measurement protocol. Nighttime mean HR is not relabelled as resting HR, and proprietary recharge scores are not converted into generic readiness.

The public API license requires explicit user authorization, appropriate data-use/privacy disclosure, source attribution, and explicit permission for distribution to outside services. The existing app's explicit cloud-model consent boundary must also cover any requested external model use of imported data; this connector does not itself call a model or supply legal/production approval.

### Suunto Cloud

| Purpose | Verified request |
|---|---|
| Authorize | `GET https://cloudapi-oauth.suunto.com/oauth/authorize` |
| Exchange / refresh | `POST https://cloudapi-oauth.suunto.com/oauth/token`, HTTP Basic client credentials |
| Exercises | `GET https://cloudapi.suunto.com/v3/workouts?since=<ms>&until=<ms>&limit=100&offset=...&filter-by-modification-time=false` |
| Steps | `GET https://cloudapi.suunto.com/247/daily-activity-statistics?startdate=<ISO>&enddate=<ISO>` |
| Sleep | `GET https://cloudapi.suunto.com/247samples/sleep?from=<ms>&to=<ms>` |
| Revoke | `GET https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=...` |

Data requests carry a bearer token and `Ocp-Apim-Subscription-Key`. The v3 workout API is used; older v2 examples are not copied. The explicit false modification-time parameter means the 28-day window applies to workout start. Pagination is capped at five pages / 500 records, with a partial-data issue when capped or interrupted after verified pages.

The parser reads `workoutKey`, `startTime` in epoch milliseconds, `totalTime` in seconds, `totalDistance` in metres, workout calories, and measured workout HR fields. It does not substitute a user's configured maximum HR. Cadence remains unknown because its step-pair/rpm protocol is not converted by assumption.

Steps keep distinct official source names and preserve actual zero; null samples are omitted. Sleep segments keep supplied `SleepId` where safely represented, or an explicit interval identity if no ID was provided. Unsafe numeric int64 IDs are skipped. Sleep duration's possibly-awake algorithm is disclosed, and average sleep HRV is marked method-unspecified. No stress/recovery score is invented.

Suunto publicly limits Cloud API access to accepted company/organization partners, requires an API agreement and a product subscription, and does not offer personal-use API access. Production permissions, subscription tier, partner terms, and any regional endpoint arrangement must be confirmed with Suunto. The confidential signed agreement was not available or assumed. The older FAQ's sleep statement is stale relative to the current official API catalog/schema; current 24/7 operations were used instead.

### Huawei Health

Official material indicates qualification/application, authentication and data authorization requirements. Current accessible public material did not establish a complete trustworthy deployment-specific OAuth/scope/data schema contract. Therefore Huawei does not exchange tokens or call a guessed health API. Status and actions explicitly report `APPROVAL_REQUIRED` until actual approved integration information is available.

### Strava boundary

The ordinary Strava API is not part of these cloud connectors and its data is not imported into the AI coaching pipeline. Strava's June 2026 agreement/policy restrict ordinary API data use in AI, including inference/context ingestion, while describing a separate official Strava MCP route. Any separate MCP authorization/capability implementation is owned by the parent/other agent; it must not be described as permission to reuse ordinary API data.

## Verification evidence

The fresh synthetic verification command is:

```sh
node --experimental-strip-types --test --test-isolation=none --test-reporter=tap src/lib/health/cloud-parse.test.ts src/lib/health/cloud-providers.test.ts src/lib/health/cloud-server.test.ts
```

Result: 35 tests, 35 passed, zero failures/cancellations/skips (8 parser, 4 provider, 23 server tests). `npm run typecheck:application` exited 0. The project-root `UNIFIED-SYNC-VERIFICATION.md` summarizes the final integrated gates. These are injected-fetch synthetic tests; no live provider or deployment smoke test was performed.

Covered risks: missing/zero/fractional values, source and account IDs, timezone uncertainty, observation protocols, unsupported payload shapes, 500-record pagination cap, operation budget and partial preservation, missing config, Huawei honesty, exact OAuth callback, sealed cookies, no secret output, wrong athlete, state tampering/expiry/replay, denial, CSRF and hostile host, upstream redirects, verified account identity, Suunto refresh, optional health failure, concurrent sync deduplication, and refresh/disconnect races. Eight final regressions additionally cover both providers' callback-exchange and callback-encryption cancellation, late-grant revocation, preservation of pending cookies on duplicate callbacks, new-generation replacement, pending-owner isolation, and a cancelled old exchange rejecting without clearing the new authorization cookie. The exchange/encryption and pending-cookie regressions were observed failing before their fixes; `cloud-callback-races-before.txt`, `cloud-new-generation-before.txt`, and `cloud-rejected-callback-before.txt` retain that evidence.

## Primary sources

Public documentation was retrieved read-only and without signing in. The Suunto `mapi` URLs below are its anonymous developer-documentation backend, not account/data endpoints. Public schemas were checked during implementation; the authoritative URLs below allow them to be rechecked. Integrated verification is summarized in the project-root UNIFIED-SYNC-VERIFICATION.md.

- Polar API reference: https://www.polar.com/accesslink-api/
- Polar public OpenAPI source: https://www.polar.com/accesslink-api/swagger.yaml
- Polar official example: https://github.com/polarofficial/accesslink-example-python
- Polar license: https://www.polar.com/en/legal/polar-api-agreement
- Suunto entry / partner requirements: https://apizone.suunto.com/ and https://apizone.suunto.com/faq
- Suunto OAuth setup: https://apizone.suunto.com/how-to-start
- Suunto current catalog: https://apizone.suunto.com/apis
- Suunto public workout operations: https://apizone.suunto.com/mapi/apis/suunto-workout-api/operations?api-version=2023-03-01-preview
- Suunto public OAuth operations: https://apizone.suunto.com/mapi/apis/oauth2-api/operations?api-version=2023-03-01-preview
- Suunto daily operations: https://apizone.suunto.com/mapi/apis/activity-and-sleep-data-api/operations?api-version=2023-03-01-preview
- Suunto current 24/7 operations: https://apizone.suunto.com/mapi/apis/new-247-api/operations?api-version=2023-03-01-preview
- Suunto workout schema: https://apizone.suunto.com/mapi/apis/suunto-workout-api/schemas/660fe0d22e817800c4a6222a?api-version=2023-03-01-preview
- Suunto 24/7 schema: https://apizone.suunto.com/mapi/apis/new-247-api/schemas/678657a5aee9ed172cf14a4c?api-version=2023-03-01-preview
- Suunto official activity mapping: https://aspartnercontent.blob.core.windows.net/apizone/docs/Activities.pdf
- Huawei open-data overview: https://developer.huawei.com/consumer/pt/doc/HMSCore-Guides/data_description-0000001467889369
- Strava API agreement: https://www.strava.com/legal/api
- Strava API policy: https://www.strava.com/legal/api_policy
- Vercel Web Handler reference: https://vercel.com/docs/functions/functions-api-reference
- Vercel Edge deprecation: https://vercel.com/docs/functions/runtimes/edge/edge-functions.rsc
- Vercel duration configuration: https://vercel.com/docs/functions/configuring-functions/duration

