import {
  buildPersonalPlan,
  validateProfile,
  reviewFeedback,
  type PersonalProfile,
  type PersonalPlan,
  type Feedback,
} from "./planner";
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
    const plan = buildPersonalPlan(s.profile, now(), (s.active?.version ?? 0) + 1);
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
  return { read, saveProfile, prepare, confirm, feedback, prepareReduction };
}
