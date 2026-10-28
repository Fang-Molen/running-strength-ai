import {
  buildPersonalPlan,
  validateProfile,
  reviewFeedback,
  type PersonalProfile,
  type PersonalPlan,
  type Feedback,
  type PersonalContext,
  type PersonalDependencyDomain,
  type Service,
} from "./planner";
import { sha256Hex } from "../../core/sha256-sync";
import { stableJson } from "../../health/analysis-evidence";

export const personalDependencyLabels: Record<PersonalDependencyDomain, string> = {
  PROFILE: "个人条件", BODY: "实测身体资料", GOAL: "目标", MEALS: "餐食", TRAINING: "实际训练与课表", RESTRICTIONS: "有效限制",
};
function dependencyState(plan: PersonalPlan, context: PersonalContext, domain: Service | "ALL") {
  const previous = plan.dependencies, current = context.dependencies;
  const nutrition = domain === "NUTRITION" || domain === "ALL" && plan.services.includes("NUTRITION");
  const keys = [...new Set([...Object.keys(previous?.domains ?? {}), ...Object.keys(current.domains)])]
    .filter(key => nutrition || !["BODY", "MEALS"].includes(key)) as PersonalDependencyDomain[];
  const unknown = keys.filter(key => !previous?.domains[key]?.version || !current.domains[key]?.version);
  const changed = keys.filter(key => previous?.domains[key]?.version && current.domains[key]?.version && previous.domains[key]!.version !== current.domains[key]!.version);
  const incompatible = !previous || previous.schema !== 1 || previous.athleteId !== current.athleteId || previous.scope !== current.scope;
  return { status: incompatible || unknown.length ? "UNKNOWN" as const : changed.length ? "STALE" as const : "FRESH" as const, changed, unknown };
}
interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
interface Proposal {
  token: string;
  expiresAt: string;
  profile: PersonalProfile;
  expectedVersion: number;
  plan: PersonalPlan;
}
interface State {
  schema: 1;
  profileSavedAt: string | null;
  profile: PersonalProfile | null;
  active: PersonalPlan | null;
  proposal: Proposal | null;
  feedback: { at: string; value: Feedback; review: ReturnType<typeof reviewFeedback> }[];
}
export function createPersonalStore(
  storage: Storage,
  actor: () => string,
  now: () => string = () => new Date().toISOString(),
  readContext?: (profile: PersonalProfile, asOf: string) => PersonalContext,
) {
  const key = () => `fk:personal-coach:v1:${encodeURIComponent(actor())}`;
  function read(): State {
    const raw = storage.getItem(key());
    if (!raw)
      return {
        schema: 1,
        profileSavedAt: null,
        profile: null,
        active: null,
        proposal: null,
        feedback: [],
      };
    const s = JSON.parse(raw) as State;
    if (s.schema !== 1 || !Array.isArray(s.feedback)) throw Error("方案存储版本无法读取");
    if (s.profile) {
      validateProfile(s.profile);
      if (s.profile.athleteId !== actor()) throw Error("身份不匹配");
    }
    if (s.active && s.active.athleteId !== actor()) throw Error("身份不匹配");
    return s;
  }
  function write(s: State) {
    storage.setItem(key(), JSON.stringify(s));
  }
  function context(profile: PersonalProfile): PersonalContext {
    if (readContext) return readContext(profile, now());
    return { profile, dependencies: { schema: 1, athleteId: profile.athleteId, scope: "PROFILE_ONLY", domains: { PROFILE: { version: sha256Hex(stableJson(profile)), sources: [key()] } } } };
  }
  function candidate(s: State, c: PersonalContext) {
    return { ...buildPersonalPlan(c.profile, now(), (s.active?.version ?? 0) + 1), dependencies: c.dependencies };
  }
  function reviewActive(domain: Service | "ALL" = "ALL"): { status: "EMPTY" | "FRESH" | "STALE" | "UNKNOWN"; changed: PersonalDependencyDomain[]; unknown: PersonalDependencyDomain[]; active: PersonalPlan | null; candidate: PersonalPlan | null; clarification?: string } {
    const s = read();
    if (!s.active || !s.profile) return { status: "EMPTY" as const, changed: [] as PersonalDependencyDomain[], unknown: [] as PersonalDependencyDomain[], active: s.active, candidate: null };
    const c = context(s.profile), state = dependencyState(s.active, c, domain);
    return { ...state, active: s.active, candidate: state.status === "FRESH" || c.clarification ? null : candidate(s, c), clarification: c.clarification };
  }
  function reviewProposal(token: string) {
    const s = read();
    if (!s.proposal || !s.profile || s.proposal.token !== token) return { status: "UNKNOWN" as const, changed: [] as PersonalDependencyDomain[], unknown: [] as PersonalDependencyDomain[] };
    return dependencyState(s.proposal.plan, context(s.profile), "ALL");
  }
  function saveProfile(p: PersonalProfile) {
    if (p.athleteId !== actor()) throw Error("身份已改变");
    const s = read();
    if (p.revision !== (s.profile?.revision ?? 0)) throw Error("资料已变化，请重新读取");
    const next = { ...p, revision: p.revision + 1 };
    validateProfile(next);
    write({ ...s, profile: next, profileSavedAt: now(), proposal: null });
    return next;
  }
  function fresh(s: State) {
    const age = Date.parse(now()) - Date.parse(s.profileSavedAt ?? "");
    if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000)
      throw Error("请重新核对并保存当前身体与健康条件");
    if (s.feedback.at(-1)?.value.pain) throw Error("当前反馈有疼痛，请先评估并更新实际反馈");
  }
  function prepare() {
    const s = read();
    if (!s.profile) return null;
    fresh(s);
    const c = context(s.profile);
    if (c.clarification) throw Error(c.clarification);
    const plan = candidate(s, c);
    const proposal: Proposal = {
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.parse(now()) + 15 * 60000).toISOString(),
      profile: s.profile,
      expectedVersion: s.active?.version ?? 0,
      plan,
    };
    write({ ...s, proposal });
    return proposal;
  }
  function confirm(token: string, consent: string) {
    const s = read();
    fresh(s);
    const p = s.proposal;
    if (
      consent !== "CONFIRM_PERSONAL_PLAN" ||
      !p ||
      p.token !== token ||
      p.plan.athleteId !== actor() ||
      Date.parse(now()) > Date.parse(p.expiresAt) ||
      Date.parse(now()) < Date.parse(p.plan.createdAt) ||
      JSON.stringify(s.profile) !== JSON.stringify(p.profile) ||
      (s.active?.version ?? 0) !== p.expectedVersion
    )
      throw Error("确认已过期或资料已变化，请重新生成");
    const c = context(s.profile!);
    if (c.clarification) throw Error(c.clarification);
    const state = dependencyState(p.plan, c, "ALL");
    if (state.status !== "FRESH") throw Error(state.status === "UNKNOWN" ? "依据读取失败或来源未知，请核对后重新生成" : "关联身体、目标、餐食、训练或限制已变化，请重新生成");
    write({ ...s, active: p.plan, proposal: null });
    return p.plan;
  }
  function feedback(f: Feedback) {
    const s = read();
    if (!s.active) throw Error("请先采用方案再记录本版本反馈");
    const review = reviewFeedback(s.active, f);
    write({
      ...s,
      proposal: null,
      feedback: [...s.feedback, { at: now(), value: f, review }].slice(-120),
    });
    return review;
  }
  function prepareReduction() {
    const s = read();
    fresh(s);
    const last = s.feedback.at(-1);
    if (s.active && s.profile && dependencyState(s.active, context(s.profile), "ALL").status !== "FRESH")
      throw Error("方案依据已变化或未知，请重新核对后生成候选");
    if (
      !s.active ||
      !s.profile ||
      s.active.profileRevision !== s.profile.revision ||
      last?.value.planVersion !== s.active.version ||
      last?.review.change?.field !== "strengthSets" ||
      Date.parse(now()) - Date.parse(last.at) > 86400000
    )
      throw Error("没有当前可确认的减量建议");
    const plan: PersonalPlan = {
      ...s.active,
      createdAt: now(),
      version: s.active.version + 1,
      strength: s.active.strength.map((x) => ({
        ...x,
        moves: x.moves.map((m) => ({ ...m, sets: Math.max(1, m.sets - 1) })),
      })),
    };
    const proposal: Proposal = {
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.parse(now()) + 15 * 60000).toISOString(),
      profile: s.profile,
      expectedVersion: s.active.version,
      plan,
    };
    write({ ...s, proposal });
    return proposal;
  }
  function reject(token: string) {
    const s = read();
    if (!s.proposal || s.proposal.token !== token) throw Error("草案已变化，请重新读取");
    write({ ...s, proposal: null });
  }
  return { read, saveProfile, prepare, confirm, feedback, prepareReduction, reviewActive, reviewProposal, reject };
}
