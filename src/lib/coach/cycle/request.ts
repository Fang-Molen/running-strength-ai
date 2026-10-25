import type { CycleRequest } from "./types";
/** Window selection is draft metadata, never an implicit change to the athlete's saved goal. */
export function cycleRequestFromText(text: string): { request?: CycleRequest } | null {
  if (/朋友|队友|假设|举例|不要生成|不要安排|不生成/.test(text)) return null;
  const month =
    /(?:后面|未来|接下来|后续|下)?(?:一个月|一月|1个月|四周|4周)/.test(text) &&
    /计划|课表|安排|周期/.test(text);
  if (!month && !/周期|备赛|阶段计划/.test(text)) return null;
  return month
    ? { request: { historyDays: /两周|2周|14天|十四天/.test(text) ? 14 : 28, horizonWeeks: 4 } }
    : {};
}
