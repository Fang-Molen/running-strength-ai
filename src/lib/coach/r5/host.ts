import {
  readEffectiveTrainingProfile,
  describeEffectiveTrainingProfile,
} from "../loop/effective-training";
import { requireR5Scope, r5ScopeReady } from "./scope";
/** Explicit-confirmation orchestration. Models have no access to this write port. */
import { currentAthleteId, dispatchEvent, loadEvents } from "../../core/events";
import { currentStore } from "../../core/storage";
import { appendJournal, readJournal } from "../../core/storage-journal";
import { readAnalysis } from "../../health/analysis-host";
import { analysisDigest } from "../../health/analysis-evidence";
import {
  appendSymptom,
  readSymptoms,
  reviseSymptom,
  symptomHistory,
} from "../../health/symptom-store";
import { reviewSymptoms } from "../../health/symptom-review";
import { healthChanged, localDay } from "../../health/observation";
import { loadChecks, upsertCheck, type BodyCheck } from "../../nutrition/body";
import {
  loadProfile,
  profileStorageKey,
  nextProfileFieldTimes,
  type Profile,
} from "../../strength/profile";
import { readEffectiveProfile } from "../loop/effective-host";
import {
  loadSchedule,
  readScheduleDocument,
  saveSchedule,
  type R5ScheduleAudit,
} from "../../ui/day-schedule";
import { withScheduleLock } from "../../ui/schedule-writer";
import { r4CourseStarted } from "../r4/courses";
import { parseR5Intent, currentMessageSafety } from "./intents";
import {
  describePair,
  easyRun,
  reduceSets,
  entryVersion,
  type R5Command,
  type SchedulePair,
} from "./commands";
export const R5_CHANGED = "fk-r5-changed";
const prefix = () => `fk-r5-command:${encodeURIComponent(currentAthleteId())}:`;
export function r5Changed() {
  if (typeof window !== "undefined") {
    for (const e of [
      R5_CHANGED,
      "fk-profile-changed",
      "fk-schedule-changed",
      "fk-training-corrected",
    ])
      window.dispatchEvent(new Event(e));
  }
  healthChanged();
}
export function readR5Commands(): R5Command[] {
  if (!r5ScopeReady()) return [];
  const map = new Map<string, R5Command>();
  for (const r of readJournal<R5Command>(prefix()))
    if (r.data?.athleteId === currentAthleteId() && r.data.schema === 1) map.set(r.data.id, r.data);
  return [...map.values()]
    .reverse() // Newest journal insertion wins when generated timestamps tie.
    .map(reconcileCommandReceipt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function saveCommand(c: R5Command) {
  const ok = appendJournal(prefix(), `${c.id}:${c.history.length}`, c);
  if (ok && typeof window !== "undefined") window.dispatchEvent(new Event(R5_CHANGED));
  return ok;
}
export function readR5Context(now = new Date().toISOString()) {
  requireR5Scope();
  const day = localDay(new Date(now)),
    owner = currentAthleteId(),
    calendar = readScheduleDocument();
  if (!calendar.ok) throw Error(calendar.reason);
  const a = readAnalysis(day, now),
    profile = loadProfile(),
    checks = loadChecks(),
    symptoms = readSymptoms(now),
    rawProfile = currentStore()?.getItem(profileStorageKey()) ?? null;
  const safety = reviewSymptoms(symptoms, day, 14),
    hold =
      ["HOLD_ACTIVE", "ESCALATION_REQUIRED"].includes(a.assessment.safetyState) ||
      safety.safety !== "NO_KNOWN_HOLD" ||
      !!profile.limit.trim();
  const entries = loadSchedule().entries,
    trainingProfile = readEffectiveTrainingProfile();
  return {
    day,
    owner,
    entries,
    profile,
    trainingProfile,
    checks,
    symptoms,
    rawProfile,
    analysis: a,
    hold,
    safety:
      hold && safety.safety === "NO_KNOWN_HOLD"
        ? {
            ...safety,
            message: `当前疼痛或健康限制仍需复核${profile.limit ? "：" + profile.limit : ""}；暂停诱发症状的内容，不能用设备分数或改课解除。`,
          }
        : safety,
    basisVersion: analysisDigest([
      owner,
      entries,
      rawProfile,
      checks,
      a.revision,
      symptoms,
      trainingProfile.version,
    ]),
  };
}
export type R5Prepared =
  | { kind: "PROPOSAL"; command: R5Command }
  | { kind: "ANSWER"; text: string }
  | { kind: "WEEKLY" }
  | { kind: "NONE" };
export function prepareR5Command(question: string, now = new Date().toISOString()): R5Prepared {
  const intent = parseR5Intent(question, now);
  if (intent.kind === "NONE") return { kind: "NONE" };
  if (intent.kind === "WEEKLY") return { kind: "WEEKLY" };
  if (intent.kind === "CLARIFY") return { kind: "ANSWER", text: intent.message };
  try {
    const c = readR5Context(now),
      old = readR5Commands().find(
        (x) =>
          x.question === question &&
          x.status === "PENDING" &&
          x.basisVersion === c.basisVersion &&
          x.expiresAt > now,
      );
    if (old) return { kind: "PROPOSAL", command: old };
    const cmd: R5Command = {
      schema: 1,
      id: crypto.randomUUID(),
      athleteId: c.owner,
      question: question.slice(0, 1000),
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + 15 * 60000).toISOString(),
      basisVersion: c.basisVersion,
      status: "PENDING",
      kind: "SCHEDULE",
      diff: [],
      warnings: [],
      history: [{ at: now, action: "PREVIEWED" }],
    };
    if (intent.kind === "MEASUREMENT") {
      cmd.kind = "MEASUREMENT";
      cmd.measurement = {
        day: intent.day,
        weight: intent.weight,
        before: c.checks.find((x) => x.date === intent.day) ?? null,
      };
      cmd.diff = [
        `${intent.historical ? "历史更正" : "当前测量"} · ${intent.day}：${cmd.measurement.before?.weight ?? "未记录"} → ${intent.weight} kg`,
      ];
      cmd.warnings = ["这是实测体重记录，不是目标值；原测量及更正依据保留。"];
    } else if (intent.kind === "PROFILE") {
      const fields = Object.keys(intent.patch) as (keyof Profile)[];
      cmd.kind = "PROFILE";
      cmd.profile = {
        patch: intent.patch,
        before: Object.fromEntries(fields.map((k) => [k, c.profile[k]])),
        absent: fields.filter((k) => !Object.hasOwn(JSON.parse(c.rawProfile ?? "{}"), k)),
      };
      cmd.diff = fields.map(
        (k) =>
          `${
            (
              {
                targetKg: "目标体重",
                age: "年龄",
                heightCm: "身高",
                trainingDays: "可训练日",
                equipment: "器材",
                note: "备注",
                limit: "身体限制",
              } as Record<string, string>
            )[k] ?? k
          }：${String(c.profile[k]) || "未知"} → ${String(intent.patch[k])}`,
      );
      if ("limit" in intent.patch && !intent.patch.limit?.trim())
        throw Error("对话不能解除身体限制；请到健康限制中人工核对");
    } else if (intent.kind === "SYMPTOM") {
      cmd.kind = "SYMPTOM";
      cmd.symptom = intent.input;
      const side = { LEFT: "左", RIGHT: "右", BILATERAL: "双侧", UNSPECIFIED: "侧别未知" }[
        intent.input.side
      ];
      cmd.diff = [
        `${side}${intent.input.region} · ${intent.input.kind === "PAIN" ? "疼痛" : "酸痛"} ${intent.input.severity ?? "程度未知"}/10；持续${intent.input.durationHours ?? "未知"}小时；诱发 ${intent.input.trigger ?? "未知"}；功能 ${intent.input.functionImpact}`,
      ];
      cmd.warnings = [
        reviewSymptoms(
          [
            {
              ...intent.input,
              id: cmd.id,
              revision: 0,
              athleteId: c.owner,
              recordedAt: now,
              retracted: false,
              source: "USER_CONFIRMED",
            },
          ],
          c.day,
          3,
        ).message,
      ];
    } else {
      const target = c.entries.filter(
        (e) =>
          e.status === "planned" &&
          !e.actual &&
          !r4CourseStarted(e) &&
          (intent.kind === "EASY_RUN"
            ? e.date === intent.day &&
              (e.modality === "run" ||
                e.trainingType === "mixed" ||
                e.runComponents?.some((x) => x.modality === "RUNNING"))
            : intent.days.includes(e.date) &&
              e.date >= c.day &&
              (e.modality === "strength" || e.trainingType === "mixed" || !!e.exercises?.length)),
      );
      if (!target.length)
        throw Error(
          "该日期没有可核对、未开始的已保存课程。请先在日历保存具体课程；不会猜测或覆盖原 V4 文本课表。",
        );
      if (intent.kind === "EASY_RUN" && target.length > 1)
        throw Error("该日期有多节跑步课，请先在日历选定具体一节。");
      cmd.pairs = target.map((e) => ({
        before: e,
        after: intent.kind === "EASY_RUN" ? easyRun(e) : reduceSets(e),
      }));
      if (c.hold && intent.kind === "EASY_RUN")
        throw Error(
          "当前疼痛或身体限制仍在生效；不能把强度课直接放行为轻松跑。可先暂缓诱发症状的训练，并到健康页核对。",
        );
      cmd.diff = cmd.pairs.map(describePair);
      cmd.warnings = [
        "关键课目的会改变，确认后才生效；原计划、实际训练和审计记录保留。",
        ...(c.hold ? ["有安全限制：减组不是训练放行，仍需暂停诱发症状的动作。"] : []),
      ];
      const races = c.profile.marks.filter(
        (m) =>
          m.deadline &&
          target.some((t) => Math.abs(Date.parse(m.deadline) - Date.parse(t.date)) <= 2 * 86400000),
      );
      if (races.length)
        cmd.warnings.push("课程临近已记录比赛：保护原比赛与关键课日期，此预览不会移动其他课。");
    }
    if (!saveCommand(cmd)) throw Error("预览保存失败；没有修改资料或课表");
    return { kind: "PROPOSAL", command: cmd };
  } catch (e) {
    return {
      kind: "ANSWER",
      text: e instanceof Error ? e.message : "当前依据无法读取；没有修改资料或课表。",
    };
  }
}
const fail = (message: string) => ({ ok: false as const, message });
function scheduleReceipts(): R5ScheduleAudit[] {
  const d = readScheduleDocument();
  return d.ok
    ? ((d.value as typeof d.value & { r4Receipts?: R5ScheduleAudit[] }).r4Receipts ?? []).filter(
        (x) => x.athleteId === currentAthleteId() && ["R5_CHANGE", "R5_UNDO"].includes(x.kind),
      )
    : [];
}
export function commitR5Schedule(
  pairs: SchedulePair[],
  id: string,
  reason: string,
  undo = false,
  now = new Date().toISOString(),
): boolean {
  if (
    !pairs.length ||
    scheduleReceipts().some(
      (x) => x.proposalId === id && x.kind === (undo ? "R5_UNDO" : "R5_CHANGE"),
    )
  )
    return false;
  const s = loadSchedule(),
    changed = new Map(pairs.map((p) => [p.after.id, p.after]));
  for (const p of pairs) {
    const old = s.entries.find((e) => e.id === p.after.id);
    if (
      p.before
        ? !old ||
          entryVersion(old) !== entryVersion(p.before) ||
          r4CourseStarted(old) ||
          !!old.actual
        : !!old
    )
      return false;
  }
  const audit: R5ScheduleAudit = {
    id: crypto.randomUUID(),
    athleteId: currentAthleteId(),
    kind: undo ? "R5_UNDO" : "R5_CHANGE",
    at: now,
    before: pairs[0].before ?? pairs[0].after,
    after: pairs[0].after,
    proposalId: id,
    pairs: structuredClone(pairs),
    reason,
  };
  return saveSchedule(
    {
      ...s,
      entries: [
        ...s.entries.map((e) => changed.get(e.id) ?? e),
        ...pairs.filter((p) => !p.before).map((p) => p.after),
      ],
    },
    "plan-execution",
    audit,
  );
}
function profileReceipts(): { id: string; undo: boolean; at: string }[] {
  try {
    return JSON.parse(currentStore()?.getItem(profileStorageKey()) ?? "null")?._r5Receipts ?? [];
  } catch {
    return [];
  }
}
function commitProfile(
  patch: Partial<Profile>,
  id: string,
  undo: boolean,
  now: string,
  remove: (keyof Profile)[] = [],
) {
  const box = currentStore();
  if (!box) return false;
  try {
    const raw = box.getItem(profileStorageKey()),
      original = JSON.parse(raw ?? "null"),
      next = {
        ...(original ?? {}),
        ...patch,
        _savedAt: now,
        _fieldSavedAt: nextProfileFieldTimes(original, patch as Record<string, unknown>, now),
        _r5Receipts: [...profileReceipts(), { id, undo, at: now }],
      };
    for (const field of remove) delete (next as Record<string, unknown>)[field];
    const out = JSON.stringify(next);
    box.setItem(profileStorageKey(), out);
    return box.getItem(profileStorageKey()) === out;
  } catch {
    return false;
  }
}
function reconcileCommandReceipt(cmd: R5Command): R5Command {
  try {
    let accepted = false,
      undone = false,
      receipt = cmd.receipt;
    if (cmd.kind === "SCHEDULE") {
      const rows = scheduleReceipts().filter((r) => r.proposalId === cmd.id);
      accepted = rows.some((r) => r.kind === "R5_CHANGE");
      undone = rows.some((r) => r.kind === "R5_UNDO");
    }
    if (cmd.kind === "MEASUREMENT") {
      const row = bodyCommandReceipt(cmd.id);
      accepted = !!row;
      undone = !!bodyCommandReceipt(cmd.id, true);
      if (row) receipt = { at: row.timestamp, afterBody: row.payload.bodyCheck as BodyCheck };
    }
    if (cmd.kind === "PROFILE") {
      const rows = profileReceipts().filter((r) => r.id === cmd.id);
      accepted = rows.some((r) => !r.undo);
      undone = rows.some((r) => r.undo);
    }
    if (cmd.kind === "SYMPTOM") {
      const history = symptomHistory().filter((r) => r.id === cmd.id);
      accepted = history.some((r) => r.revision === 0);
      undone = history.at(-1)?.retracted ?? false;
      const original = history.find((r) => r.revision === 0);
      if (original)
        receipt = {
          at: original.recordedAt,
          symptomId: original.id,
          symptomRevision: 0,
          symptomVersion: analysisDigest(original),
        };
    }
    return undone
      ? { ...cmd, status: "UNDONE", receipt }
      : accepted
        ? { ...cmd, status: "ACCEPTED", receipt }
        : cmd;
  } catch {
    return cmd;
  }
}
function bodyCommandReceipt(id: string, undo = false) {
  return loadEvents().find(
    (e) =>
      e.athlete_id === currentAthleteId() &&
      e.event_type === "BODY_MEASUREMENT_RECORDED" &&
      (undo ? e.payload.r5UndoOf === id : e.payload.r5CommandId === id),
  );
}
async function act(id: string, action: "ACCEPT" | "REJECT" | "UNDO", now: string) {
  const cmd = readR5Commands().find((x) => x.id === id);
  if (!cmd || cmd.athleteId !== currentAthleteId())
    return fail("当前身份下找不到这项修改，未写入其他档案");
  const c = readR5Context(now);
  if (action === "ACCEPT" && cmd.kind !== "SYMPTOM" && currentMessageSafety(cmd.question))
    return fail(currentMessageSafety(cmd.question)!);
  if (action === "REJECT") {
    if (cmd.status !== "PENDING") return fail("该项已经处理过");
    return saveCommand({
      ...cmd,
      status: "REJECTED",
      history: [...cmd.history, { at: now, action: "REJECTED" }],
    })
      ? { ok: true as const, message: "已拒绝；资料和计划没有改变。" }
      : fail("拒绝记录保存失败");
  }
  if (action === "UNDO") {
    if (cmd.status !== "ACCEPTED") return fail("这项修改未接受或已经撤销");
    if (cmd.kind === "SCHEDULE") {
      if (!cmd.pairs?.every((p) => p.before)) return fail("撤销依据不完整");
      if (
        !commitR5Schedule(
          cmd.pairs!.map((p) => ({ before: p.after, after: p.before! })),
          cmd.id,
          "撤销对话改课",
          true,
          now,
        )
      )
        return fail("训练已变化或开始，撤销未覆盖新记录");
    } else if (cmd.kind === "MEASUREMENT") {
      const m = cmd.measurement!,
        current = c.checks.find((x) => x.date === m.day);
      if (
        bodyCommandReceipt(id, true) ||
        !current ||
        analysisDigest(current) !== analysisDigest(cmd.receipt?.afterBody)
      )
        return fail("该测量后来已更新，不能覆盖新记录");
      if (
        !dispatchEvent(
          "BODY_MEASUREMENT_RECORDED",
          m.before
            ? { bodyCheck: { ...m.before, athleteId: c.owner }, r5UndoOf: id }
            : { removedCheckDate: m.day, r5UndoOf: id },
        )
      )
        return fail("撤销事件保存失败");
      const restored = loadChecks().find((x) => x.date === m.day);
      if (m.before ? restored?.weight !== m.before.weight : !!restored)
        return fail("撤销事件已保存但投影未还原，请核对原始记录");
    } else if (cmd.kind === "PROFILE") {
      const p = cmd.profile!;
      if (
        Object.entries(p.patch).some(
          ([k, v]) => JSON.stringify(c.profile[k as keyof Profile]) !== JSON.stringify(v),
        ) ||
        profileReceipts().some((x) => x.id === id && x.undo)
      )
        return fail("资料后来已修改，不能覆盖新值");
      if (!commitProfile(p.before, id, true, now, p.absent ?? [])) return fail("撤销保存失败");
    } else if (cmd.kind === "SYMPTOM") {
      const row = readSymptoms(now).find((x) => x.id === cmd.receipt?.symptomId);
      if (
        !row ||
        row.revision !== cmd.receipt?.symptomRevision ||
        analysisDigest(row) !== cmd.receipt?.symptomVersion ||
        !reviseSymptom(row.id, row.revision, {}, true, now).ok
      )
        return fail("症状记录已经变化，请从健康页核对更正");
    } else return fail("请从周复盘卡撤销周计划");
    const updated = {
      ...cmd,
      status: "UNDONE" as const,
      history: [...cmd.history, { at: now, action: "UNDONE" }],
    };
    saveCommand(updated);
    r5Changed();
    return { ok: true as const, message: "已撤销；原记录与修改历史均保留，旧结论将复核。" };
  }
  if (cmd.status !== "PENDING") return fail("已经处理过，未重复提交");
  const already =
    cmd.kind === "SCHEDULE"
      ? scheduleReceipts().some((x) => x.proposalId === id && x.kind === "R5_CHANGE")
      : cmd.kind === "MEASUREMENT"
        ? !!bodyCommandReceipt(id)
        : cmd.kind === "PROFILE"
          ? profileReceipts().some((x) => x.id === id && !x.undo)
          : readSymptoms(now).some((x) => x.id === id);
  if (already) {
    const priorBody = bodyCommandReceipt(id)?.payload.bodyCheck as BodyCheck | undefined;
    saveCommand({
      ...cmd,
      status: "ACCEPTED",
      receipt: {
        at: now,
        ...(priorBody ? { afterBody: priorBody } : {}),
        ...(cmd.kind === "SYMPTOM" ? { symptomId: id } : {}),
      },
      history: [...cmd.history, { at: now, action: "RECEIPT_RECOVERED" }],
    });
    return fail("已找到先前写入回执，不会重复执行；请刷新核对");
  }
  if (
    !Number.isFinite(Date.parse(now)) ||
    now < cmd.createdAt ||
    now > cmd.expiresAt ||
    cmd.basisVersion !== c.basisVersion
  ) {
    saveCommand({
      ...cmd,
      status: "STALE",
      history: [...cmd.history, { at: now, action: "BASIS_CHANGED" }],
    });
    return fail("依据、版本或时间已经变化；请重新预览后确认，没有覆盖当前记录。");
  }
  let receipt: R5Command["receipt"] = { at: now };
  if (cmd.kind === "SCHEDULE") {
    if (
      c.hold &&
      cmd.pairs?.some((p) => p.after.modality === "run" && p.after.title.includes("轻松跑"))
    )
      return fail("当前安全限制不能通过改成轻松跑解除");
    if (!commitR5Schedule(cmd.pairs ?? [], id, cmd.question, false, now))
      return fail("日历写入失败或课程已变化，请刷新核对");
  } else if (cmd.kind === "MEASUREMENT") {
    const m = cmd.measurement!,
      before = c.checks.find((x) => x.date === m.day);
    const row: BodyCheck = {
      ...before,
      id: before?.id ?? `r5-body:${id}`,
      date: m.day,
      weight: m.weight,
      athleteId: c.owner,
      source: "MANUAL",
      recordedAt: now,
    };
    if (
      !dispatchEvent("BODY_MEASUREMENT_RECORDED", {
        date: m.day,
        weight: m.weight,
        bodyCheck: row,
        r5CommandId: id,
      })
    )
      return fail("测量事件保存失败");
    receipt.afterBody = row;
  } else if (cmd.kind === "PROFILE") {
    if (!commitProfile(cmd.profile!.patch, id, false, now)) return fail("资料保存失败");
  } else if (cmd.kind === "SYMPTOM") {
    const saved = appendSymptom(cmd.symptom!, now, id);
    if (!saved.ok) return fail(saved.message);
    receipt.symptomId = saved.row.id;
    receipt.symptomRevision = saved.row.revision;
    receipt.symptomVersion = analysisDigest(saved.row);
  } else return fail("请从周复盘卡确认周计划");
  const updated = {
    ...cmd,
    status: "ACCEPTED" as const,
    acceptedBasis: readR5Context(now).basisVersion,
    receipt,
    history: [...cmd.history, { at: now, action: "ACCEPTED" }],
  };
  const auditSaved = saveCommand(updated);
  r5Changed();
  return {
    ok: true as const,
    message: auditSaved
      ? "已按你的确认保存，相关资料和判断已刷新；可以撤销。"
      : "修改已写入且保留原始回执，但卡片状态保存失败；请刷新核对，勿重复提交。",
  };
}
export async function decideR5Command(
  id: string,
  action: "ACCEPT" | "REJECT" | "UNDO",
  now = new Date().toISOString(),
) {
  const owner = currentAthleteId();
  if (typeof window !== "undefined" && !navigator.locks?.request)
    return fail("当前浏览器无法协调跨页面确认，请使用支持 Web Locks 的浏览器；没有执行这次修改");
  try {
    return (
      await withScheduleLock(() =>
        currentAthleteId() === owner ? act(id, action, now) : fail("身份已经变化，未写入"),
      )
    ).value;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "读取或保存失败；请核对当前记录");
  }
}
export function r5CurrentFacts(now = new Date().toISOString()): string {
  const c = readR5Context(now),
    p = readEffectiveProfile();
  return [
    `当前体重 ${p.weightKg?.value ?? "未知"} kg；年龄 ${p.age?.value ?? "未知"}；目标 ${p.goal?.value ?? "未知"}。`,
    c.profile.limit ? `用户身体限制：${c.profile.limit}` : "身体限制未完整确认。",
    c.safety.message,
    ...describeEffectiveTrainingProfile(c.trainingProfile),
    ...readR5Commands()
      .filter((x) => x.status !== "PENDING")
      .slice(0, 3)
      .map((x) => `${x.status}：${x.diff.join("；")}；旧结论需随修订复核。`),
  ].join("\n");
}
