/** Additional effective context over the existing stores. Not a second athlete database. */
import { currentAthleteId } from "../../core/events";
import { currentStore } from "../../core/storage";
import {
  loadProfile,
  profileFieldTimes,
  profileSavedAt,
  profileStorageKey,
} from "../../strength/profile";
import { createPersonalStore } from "../personal/store";
import type { Known } from "./effective-profile";
import { analysisDigest } from "../../health/analysis-evidence";
import { interpretProfileLimit } from "../utterance-semantics";
export function readEffectiveTrainingProfile() {
  const profile = loadProfile(),
    at = profileSavedAt(),
    times = profileFieldTimes(),
    raw = currentStore()?.getItem(profileStorageKey()) ?? null;
  let stored: Record<string, unknown> | null = null;
  try {
    stored = JSON.parse(raw ?? "null");
  } catch {
    /* unknown */
  }
  let personal: ReturnType<ReturnType<typeof createPersonalStore>["read"]> | null = null;
  try {
    const box = currentStore();
    if (box) personal = createPersonalStore(box, currentAthleteId).read();
  } catch {
    /* unreadable stays unknown */
  }
  const main = <T>(field: string, value: T): Known<T> | null =>
    stored && field in stored
      ? {
          value,
          source: "ATHLETE_PROFILE",
          at: field in times ? times[field] : at,
          version: analysisDigest([field, stored[field], times[field] ?? at]),
        }
      : null;
  const pp = personal?.profile,
    pat = personal?.profileSavedAt ?? null;
  const other = <T>(value: T): Known<T> | null =>
    pp ? { value, source: "PERSONAL_COACH", at: pat, version: `personal:r${pp.revision}` } : null;
  const conflicts: string[] = [];
  const pick = <T>(field: string, a: Known<T> | null, b: Known<T> | null): Known<T> | null => {
    if (a && b && JSON.stringify(a.value) !== JSON.stringify(b.value))
      conflicts.push(`${field}在运动员档案与私人教练资料不一致；按时间优先并保留冲突，需核对。`);
    return (
      [a, b]
        .filter((x): x is Known<T> => x !== null)
        .sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0))[0] ?? null
    );
  };
  const days = pick(
    "训练日",
    profile.trainingDays ? main("trainingDays", profile.trainingDays) : null,
    pp ? other(pp.days) : null,
  );
  const minutes = pick(
    "单次可用时间",
    main("minutes", profile.minutes),
    pp ? other(pp.minutes) : null,
  );
  const equipment = pick(
    "器材",
    profile.equipment ? main("equipment", profile.equipment) : null,
    pp ? other(pp.equipment as string) : null,
  );
  const limitState = interpretProfileLimit(profile.limit);
  const restrictions = [
    ...(limitState.active
      ? [main("limit", profile.limit)].filter((x): x is Known<string> => !!x)
      : []),
    ...(pp && pp.screen !== "CLEAR"
      ? [other(`健康筛查：${pp.screen}`)].filter((x): x is Known<string> => !!x)
      : []),
  ];
  const notes = profile.note.trim() ? main("note", profile.note) : null,
    daysPerWeek = main("days", profile.days),
    strengthExperience = pp?.services.includes('STRENGTH')
      ? other(pp.experience === 'TRAINED' ? 'TRAINED' as const : 'NOVICE' as const)
      : null;
  return {
    days,
    daysPerWeek,
    minutes,
    equipment,
    ...(strengthExperience ? { strengthExperience } : {}),
    restrictions,
    notes,
    conflicts,
    version: analysisDigest([
      days,
      daysPerWeek,
      minutes,
      equipment,
      strengthExperience,
      restrictions,
      notes,
      conflicts,
    ]),
    sourceRule: "已确认日期优先；训练次数不推断具体星期；限制取并集，不以无痛或CLEAR清除。",
  };
}
export function describeEffectiveTrainingProfile(p = readEffectiveTrainingProfile()) {
  const show = <T>(name: string, v: Known<T> | null) =>
    v
      ? `${name}：${Array.isArray(v.value) ? v.value.join(",") : v.value}（${v.source}，${v.at ?? "时间未知"}）`
      : `${name}：未知`;
  return [
    show("训练日（0=周日）", p.days),
    show("每周次数", p.daysPerWeek),
    show("可用分钟", p.minutes),
    show("器材", p.equipment),
    ...p.restrictions.map((x) => show("限制", x)),
    show("用户备注", p.notes),
    ...p.conflicts,
  ];
}
