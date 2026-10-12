export const TRIAL_LABEL = "跑步力量 · 试用版";
export const TRIAL_VERSION = "试用-2026-10-09";
export const LOCAL_BACKUP_KIND = "fr255-local-backup";

type ReviewGate = {
  pain: { status: string; value: { location?: string; intensity?: number | null } | null };
  sessionRpe: { status: string; value: number | null };
  subjectiveRecovery: { status: string };
};

export function trialReviewClosed(record: ReviewGate): string | null {
  const pain =
    record.pain.status === "RECORDED" &&
    record.pain.value != null &&
    (Boolean(record.pain.value.location?.trim()) || record.pain.value.intensity != null);
  const highRpe =
    record.sessionRpe.status === "RECORDED" &&
    typeof record.sessionRpe.value === "number" &&
    record.sessionRpe.value >= 8;
  const recoveryMissing = record.subjectiveRecovery.status !== "RECORDED";
  if (!(pain && highRpe && recoveryMissing)) return null;
  return "试用版暂不开放「疼痛且整课 RPE 达到 8、主观恢复未记录」的模型复盘。上面的规则判断仍然有效，不会据此加量，也不是诊断。";
}

type BackupStore = {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

// R2 journal keys include a logical UUID and an independent physical UUID.
// Retain the old bound for other keys, and allow only known journal namespaces to grow.
const supportedBackupKey = (key: string) =>
  key.startsWith("fr255-") &&
  (key.length <= 80 ||
    (key.length <= 320 && /^fr255-runner-draft-v1:[a-zA-Z0-9_-]{1,80}:[a-zA-Z0-9_-]{1,80}:[a-zA-Z0-9_-]{1,80}:\d{1,5}$/.test(key)) ||
    (key.length <= 160 &&
      /^fr255-(?:event-journal-v2|cognition-journal-r2|coach-intake-r2|running-tx-r3):[a-zA-Z0-9_-]+:[0-9a-f-]{36}$/.test(
        key,
      )));

export function collectLocalBackup(
  storage: Pick<BackupStore, "length" | "key" | "getItem">,
  exportedAt = new Date().toISOString(),
): string {
  const keys: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith("fr255-")) continue;
    const value = storage.getItem(key);
    if (value != null) keys[key] = value;
  }
  return JSON.stringify({ kind: LOCAL_BACKUP_KIND, version: TRIAL_VERSION, exportedAt, keys });
}

export function inspectLocalBackup(
  raw: string,
  storage: Pick<BackupStore, "getItem">,
):
  | {
      ok: true;
      total: number;
      added: number;
      overwritten: number;
      unchanged: number;
      exportedAt: string | null;
    }
  | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "备份文件无法读取" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "备份文件无法读取" };
  const body = parsed as { kind?: unknown; keys?: unknown; exportedAt?: unknown };
  if (
    body.kind !== LOCAL_BACKUP_KIND ||
    !body.keys ||
    typeof body.keys !== "object" ||
    Array.isArray(body.keys)
  )
    return { ok: false, reason: "不是这份应用的备份" };
  let added = 0,
    overwritten = 0,
    unchanged = 0;
  for (const [key, value] of Object.entries(body.keys as Record<string, unknown>)) {
    if (!supportedBackupKey(key) || typeof value !== "string" || value.length > 2_000_000)
      return { ok: false, reason: "备份包含不支持或过大的数据项，已拒绝导入" };
    const existing = storage.getItem(key);
    if (existing === null) added++;
    else if (existing === value) unchanged++;
    else overwritten++;
  }
  const total = added + overwritten + unchanged;
  if (!total) return { ok: false, reason: "备份里没有可恢复的记录" };
  return {
    ok: true,
    total,
    added,
    overwritten,
    unchanged,
    exportedAt: typeof body.exportedAt === "string" ? body.exportedAt : null,
  };
}

export function restoreLocalBackup(
  raw: string,
  storage: Pick<BackupStore, "getItem" | "setItem" | "removeItem">,
): { ok: true; restored: number } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "备份文件无法读取" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "备份文件无法读取" };
  const body = parsed as { kind?: unknown; keys?: unknown };
  if (
    body.kind !== LOCAL_BACKUP_KIND ||
    !body.keys ||
    typeof body.keys !== "object" ||
    Array.isArray(body.keys)
  )
    return { ok: false, reason: "不是这份应用的备份" };
  const planned: { key: string; value: string; previous: string | null }[] = [];
  for (const [key, value] of Object.entries(body.keys as Record<string, unknown>)) {
    if (!supportedBackupKey(key) || typeof value !== "string" || value.length > 2_000_000) continue;
    planned.push({ key, value, previous: storage.getItem(key) });
  }
  if (planned.length === 0) return { ok: false, reason: "备份里没有可恢复的记录" };
  const applied: typeof planned = [];
  try {
    for (const item of planned) {
      storage.setItem(item.key, item.value);
      applied.push(item);
    }
  } catch {
    for (const item of applied.reverse()) {
      try {
        if (item.previous == null) storage.removeItem?.(item.key);
        else storage.setItem(item.key, item.previous);
      } catch {
        return { ok: false, reason: "恢复中断，而且没能完全退回。请先下载一份当前备份。" };
      }
    }
    return { ok: false, reason: "存储空间不足，恢复已取消，原有记录还在。" };
  }
  return { ok: true, restored: applied.length };
}
