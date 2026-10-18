import { CATALOG } from "./catalog";
import { FOOT_LIBRARY } from "../body/foot-library";
import demoData from "./demo/data.json" with { type: "json" };
export const PARTS = ["下肢", "上肢", "核心", "后链", "小腿", "全身", "快速力量"] as const;
const EXTRA: [string, string[]][] = [
  ["分腿蹲", ["下肢"]], ["保加利亚分腿蹲", ["下肢"]], ["台阶上步", ["下肢"]], ["深蹲", ["下肢", "全身"]], ["陷阱杠硬拉", ["后链", "全身"]],
  ["罗马尼亚硬拉 RDL", ["后链"]], ["臀推", ["后链", "下肢"]], ["臀桥", ["后链"]], ["北欧腿弯举", ["后链"]], ["提踵", ["小腿"]], ["膝屈提踵", ["小腿"]],
  ["Pallof 抗旋转", ["核心"]], ["死虫", ["核心"]], ["鸟狗", ["核心"]], ["侧桥", ["核心"]], ["低量弹跳", ["快速力量"]], ["蹲跳", ["快速力量"]], ["跳箱", ["快速力量"]], ["药球抛", ["快速力量", "上肢"]],
];
const GROUP_PART: Record<string, string[]> = { 腿: ["下肢"], 臀: ["下肢", "后链"], 胸: ["上肢"], 背: ["上肢"], 肩: ["上肢"], 手臂: ["上肢"], 核心: ["核心"], 全身: ["全身"] };
function partsOf(name: string, group?: string): string[] {
  const p = new Set(group ? GROUP_PART[group] ?? [] : []);
  if (/硬拉|RDL|腿弯|背伸|桥|臀/.test(name)) p.add("后链"); if (/提踵|小腿/.test(name)) p.add("小腿"); if (/跳|弹|抛|高翻|爆发/.test(name)) p.add("快速力量");
  return [...p];
}
export const LIBRARY: { name: string; parts: string[] }[] = (() => {
  const m = new Map<string, string[]>();
  for (const [n, ps] of EXTRA) m.set(n, ps);
  for (const c of CATALOG) if (!m.has(c.name)) m.set(c.name, partsOf(c.name, c.group));
  return [...m].map(([name, parts]) => ({ name, parts }));
})();


export const SECTIONS = ["胸", "背", "肩", "手臂", "腿", "臀", "核心", "全身", "足踝"] as const;
export type ActionSection = (typeof SECTIONS)[number];
export type ActionEntry = { key: string; name: string; en: string; parts: string[]; section: ActionSection; pattern: string; catalogId: string | null; sourceId: string | null; unit?: "reps" | "sec" | "m"; perSide?: boolean };
const PATTERNS: Record<string,string> = { BENCH_PRESS:"水平推", FLYE:"夹胸", PUSH_UP:"水平推", PULL_UP:"垂直拉", ROW:"水平拉", SHRUG:"耸肩", SHOULDER_PRESS:"垂直推", LATERAL_RAISE:"肩外展/前举", CURL:"屈肘", TRICEPS_EXTENSION:"伸肘", SQUAT:"蹲", DEADLIFT:"髋铰链", LUNGE:"分腿/弓步", LEG_CURL:"屈膝", CALF_RAISE:"提踵", HIP_RAISE:"髋伸展", HIP_STABILITY:"稳定控制", CARRY:"负重行走", PLANK:"核心稳定", CRUNCH:"躯干屈曲", CORE:"核心控制", SIT_UP:"躯干屈曲", LEG_RAISE:"举腿", TOTAL_BODY:"全身组合" };
/** IDs and units come from the existing catalog. No sets, dose or training state is inferred. */
export const ACTIONS: readonly ActionEntry[] = [
 ...CATALOG.map(e => ({key:`local:${e.id}`,name:e.name,en:demoData.exercises.find(d=>d.id===e.id)?.name_en ?? e.exerciseKey.replaceAll('_',' '),parts:partsOf(e.name,e.group),section:e.group,pattern:PATTERNS[e.categoryKey] ?? "其他动作",catalogId:e.id,sourceId:`local:${e.id}`,unit:e.timed ? "sec" as const : "reps" as const})),
 ...EXTRA.filter(([name])=>!CATALOG.some(e=>e.name===name)).map(([name,parts])=>({key:`extra:${name}`,name,en:'',parts:[...parts],section:(parts.includes('核心')?'核心':parts.includes('下肢')||parts.includes('后链')||parts.includes('小腿')?'腿':'全身') as ActionSection,pattern:'其他动作',catalogId:null,sourceId:null})),
 ...FOOT_LIBRARY.map(e=>({key:`foot:${e.id}`,name:e.name,en:'',parts:['小腿'],section:'足踝' as const,pattern:e.cat,catalogId:null,sourceId:`foot:${e.id}`,unit:e.dose.unit==='秒'?'sec' as const:'reps' as const})),
];
const normalize=(text:string)=>text.normalize('NFKC').trim().toLocaleLowerCase().replace(/[_-]/g,' ');
export function queryActions(entries:readonly ActionEntry[],query='',section:ActionSection|null=null,pattern:string|null=null):ActionEntry[]{
 const tokens=normalize(query).split(/\s+/).filter(Boolean);
 return entries.filter(e=>(!section||e.section===section)&&(!pattern||e.pattern===pattern)&&tokens.every(t=>normalize([e.name,e.en,e.pattern,e.section,...e.parts].join(' ')).includes(t)));
}
export function sectionCounts(entries:readonly ActionEntry[]){return SECTIONS.map(name=>({name,count:entries.filter(e=>e.section===name).length}));}
export function categoryPatterns(entries:readonly ActionEntry[],section:ActionSection){return [...new Set(entries.filter(e=>e.section===section).map(e=>e.pattern))];}
