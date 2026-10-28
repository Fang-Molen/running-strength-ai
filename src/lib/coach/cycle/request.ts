import type { CycleRequest } from "./types";

export type ParsedCycleRequest = { request?: CycleRequest; clarification?: string };
const period = /([+-]?(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+))\s*(?:个\s*)?(周|星期|天|日|月)/g;
const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function count(text: string): number | null {
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text in digits) return digits[text];
  const tens = text.match(/^([一二两三四五六七八九]?)十([一二三四五六七八九]?)$/);
  return tens ? (tens[1] ? digits[tens[1]] : 1) * 10 + (tens[2] ? digits[tens[2]] : 0) : null;
}

/** Window selection is draft metadata, never an implicit change to the athlete's saved goal. */
export function cycleRequestFromText(raw: string): ParsedCycleRequest | null {
  const text = raw.normalize("NFKC").trim();
  if (/朋友|队友|假设|举例|(?:不要|不|无需|别)(?:生成|安排|制定)/.test(text)) return null;
  const creating = /生成|制定|规划|安排|(?:做|出).{0,6}(?:计划|课表|草案)/.test(text);
  if (/解释|是什么意思|是什么|了解|科普/.test(text) && !creating) return null;
  const periods = [...text.matchAll(period)].filter(match => !/第\s*$/.test(text.slice(0, match.index))).map(match => {
    const before = text.slice(0, match.index), after = text.slice(match.index! + match[0].length);
    return {
      value: count(match[1]), unit: match[2],
      historical: /(?:最近|过去|此前|之前|近|这|前)\s*$/.test(before) || /^(?:前|以前)/.test(after),
      future: /(?:未来|后面|接下来|后续|随后)\s*$/.test(before),
      whole: match[0] === text,
    };
  });
  const future = periods.filter(item => !item.historical);
  const calendarMonth = future.some(item => item.unit === "月") || /下个月|本月|自然月|半个月/.test(text);
  if (!future.length && !calendarMonth && !/周期|备赛|阶段计划/.test(text)) return null;
  const explicitWindow = future.some(item => item.future || item.whole) ||
    (future.length > 0 || calendarMonth) && /计划|课表|草案/.test(text);
  if (!explicitWindow && !creating && !/周期|备赛|阶段计划/.test(text)) return null;
  // A historical review alone must not generate a new plan from the saved horizon.
  if (periods.length && !future.length && !creating) return null;
  const history = periods.filter(item => item.historical).map(item => item.value === null || item.unit === "月" ? null : item.value * (/周|星期/.test(item.unit) ? 7 : 1));
  if (history.some(days => days === null || ![14, 28, 42].includes(days)) || new Set(history).size > 1)
    return { clarification: "请核对复盘范围：当前支持近14、28或42天；未来计划周数单独选择，未改动已保存目标。" };
  const weeks = future.filter(item => /周|星期/.test(item.unit)).map(item => item.value);
  if (weeks.some(value => value === null || !Number.isInteger(value) || value < 1 || value > 52) || new Set(weeks).size > 1)
    return { clarification: "请明确一个1至52周的未来计划长度；当前长度无效或互相冲突，未沿用旧长度生成。" };
  if (future.some(item => /天|日/.test(item.unit)))
    return { clarification: "请用1至52周明确未来计划长度；复盘天数与未来周数分别处理。" };
  const request = weeks.length ? { historyDays: (history[0] ?? 28) as CycleRequest["historyDays"], horizonWeeks: weeks[0]! } : undefined;
  if (calendarMonth)
    return { ...(request ? { request } : {}), clarification: "自然月与固定周数不完全相同，请明确未来计划周数（1至52周）；不会自动把一个月换成四周。" };
  return request ? { request } : {};
}
