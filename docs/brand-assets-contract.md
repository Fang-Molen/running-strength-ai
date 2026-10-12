# Project-owned brand asset contract

This portable contract replaces tests' dependency on the absent Grok og skill bundle. It is not a recovered copy of that skill and does not install a skill. The repository's existing CLI guardrails remain unchanged.

## Brand-asset pass:

An independently assigned asset pass uses `/workspace/.grok/og-pending`. The marker expires after 10 minutes. Never `wait_tasks`, never `get_task_output` on that pass. Asset work is optional for this training utility; existing assets are retained.

Check the generated assets with `node scripts/brand-check.mjs --root /workspace`.

## Atomic hand-over recipes

Use staged files; the CLI validates the target and same-volume rename:

```text
node scripts/write-atomic.mjs /workspace/.grok/og.staged.jpg /workspace/public/og.jpg
node scripts/write-atomic.mjs /workspace/.grok/x-banner.staged.jpg /workspace/public/x-banner.jpg
node scripts/write-atomic.mjs /workspace/.grok/site.staged.json /workspace/src/lib/og/site.json
```
