import { currentAthleteId, setEventContext, ATHLETE_SCOPE_CHANGED } from "../../core/events";
const browserAuthRequired = () =>
  typeof window !== "undefined" && import.meta.env?.VITE_AUTH_ENABLED !== "false";
let account: string | null = null;
export const authenticatedAthleteScope = (id: string) => `account:${encodeURIComponent(id)}`;
/** Called only from the existing authenticated session hook, never from model/user prose. */
export function bindR5Session(id: string | null) {
  account = id;
  const scope = id ? authenticatedAthleteScope(id) : "session-unresolved";
  setEventContext({ athleteId: scope });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ATHLETE_SCOPE_CHANGED));
}
export function r5ScopeReady() {
  return (
    !browserAuthRequired() ||
    (!!account && currentAthleteId() === authenticatedAthleteScope(account))
  );
}
export function requireR5Scope() {
  if (!r5ScopeReady()) throw Error("登录身份尚未核验，R5没有读取或修改本机历史资料。");
}
