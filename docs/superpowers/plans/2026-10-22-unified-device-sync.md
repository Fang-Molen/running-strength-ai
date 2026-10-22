# Unified device connections implementation plan

> Execution: parallel implementation of independent adapters; root integrates the existing UI and verifies the finished source package. The user explicitly asked to complete the work and combine the windows.

## Goal and design

Keep the accepted Fangkun visual style and one device/data window. A platform selector shows one connection panel at a time. Account connections and file import are two sections in that same window. Settings, health, first-run onboarding, and standalone welcome all open the same surface. OAuth uses the current browser context and returns to the selected platform. Existing Garmin and COROS jobs and saved data retain their original contracts.

## Implementation

- [x] Root: central provider/navigation contract, shared cloud request state, unified connection UI, entry consolidation, explicit preview/save for new sources.
- [x] Cloud worker: official Polar and Suunto OAuth/read adapters, honest Huawei approval state, Cloudflare/Vercel route adapters and synthetic contract tests.
- [x] Native worker: real Capacitor HealthKit/Health Connect plugin sources and web adapter, frontend capability/permission boundaries and normalization tests. Native compilation and real device permission tests are unavailable in this Linux environment and remain release requirements.
- [x] Strava worker: personal-only official MCP OAuth and tool discovery, with server-configured personal access gate. No ordinary REST data enters the AI/training pipeline; no undocumented tool-output mapping.
- [x] Root: verify source isolation, changed-area tests, application typecheck, clean production build, mobile/desktop browser flows and a final built-UI smoke.
- [x] Root: full ZIP preserving previous deliverables and new implementation/configuration/verification notes; no deployment or real-account/model calls.

## Shared interfaces

CloudProvider is polar | suunto | huawei. CloudStatus contains provider, configured, connected, accountRef, and an optional reason. CloudPreview contains provider, accountRef, fetchedAt, activities: DeviceActivity[], health: DeviceHealthRow[], issues: string[], and partial. The /api/watch-cloud routes expose status, provider/start, provider/callback, provider/sync and provider/disconnect. Requests capture the current athlete; server tokens bind that local owner to the provider-authorized account.

NativeHealthProvider is apple_health | health_connect. The browser adapter exports getNativeHealthStatus, requestNativeHealthPermissions and readNativeHealth. Ordinary web/PWA renders needs_native_app. Native permission completion does not imply HealthKit read permission was granted.

Strava uses /api/strava-mcp with status, unlock, start, callback, capabilities and disconnect. It requires explicit personal-use deployment configuration and a separate server-verified personal access code. Tool discovery is not activity synchronization.

## Constraints and review focus

- No copied example credentials, successful fake connections, demo health records, or default personal training content.
- Missing metrics remain null; original fractional durations remain numeric. HRV methods and measurement provenance are retained and never mixed across sources.
- Saving incoming activities/health requires a visible user confirmation and uses the existing saveDeviceRows path.
- Responses arriving after athlete/authorization changes cannot update another preview or save under another owner. Reopening a panel observes the same pending job.
- All authorization callback values are validated, consumed once in the UI, and returned to one window without target=_blank or window.open.
- Preserve framework auth/preview shell, existing recovery calculations, plan/course links and trend date navigation.
- Credentials and tokens remain server-only or encrypted HttpOnly cookies. No secrets in source, client bundles, backups or logs.
- Configuration/partner approval/native packaging are real dependencies; document unresolved external verification rather than mark platforms connected.

## Verification focus

Exercise repeated clicks, switching platforms during a pending request, closing/reopening, scope changes, OAuth failure/return, configuration missing, native runtime absence, read-only Strava capability discovery, source-bound duplicate prevention, empty/partial results, and mobile focus/scroll behavior. Use synthetic data only and reuse prior unchanged-source evidence rather than repeat the whole unrelated test suite.
