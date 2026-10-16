/** t431 足部与足弓 / 踝关节 / 小腿 动作库（独立于 Garmin 动作目录，不影响课表数据）。 */
export type FootCategory = "足部与足弓" | "踝关节" | "小腿";
export type FootExercise = {
  id: string; name: string; cat: FootCategory; muscles: string[]; secondary: string[];
  demo: { motion?: string; steps: string[] }; tips: string[]; mistakes: string[];
  level: string; progress: string; dose: { sets: number; amount: number; unit: "次" | "秒" }; restSec: number; sources: string[];
};
const K = (s: string) => `Kenhub: ${s} (kenhub.com/en/library/anatomy/${s.toLowerCase().replace(/ /g, "-")})`;
const MCKEON = "McKeon PO et al. The foot core system. Br J Sports Med 2015;49:290 (PMID 24659509)";
const BAL = "Neuromuscular training for preventing ankle joint injuries in athletes: systematic review and meta-analysis (2026, PMID 42558293)";
export const FOOT_CATEGORIES: FootCategory[] = ["足部与足弓", "踝关节", "小腿"];
export const FOOT_LIBRARY: FootExercise[] = [
  { id: "ft-calf-2", name: "双脚提踵", cat: "小腿", muscles: ["gastroc_med", "gastroc_lat"], secondary: ["soleus", "foot_intrinsic"],
    demo: { motion: "calf", steps: ["双脚与髋同宽站稳，前脚掌踩在台阶或地面", "大脚趾球用力下压，脚跟尽量抬高", "顶端停 1 秒", "2–3 秒慢慢放下"] },
    tips: ["膝关节伸直但不锁死", "重心落在第一、二趾之间", "全程匀速"], mistakes: ["脚踝向外翻（重心跑到小脚趾）", "借膝盖弹震", "下放太快"],
    level: "入门", progress: "徒手 → 台阶全幅度 → 负重 → 单脚提踵", dose: { sets: 3, amount: 15, unit: "次" }, restSec: 60,
    sources: ["ExRx Standing Calf Raise (exrx.net/WeightExercises/Gastrocnemius/BWStandingCalfRaise)", K("Gastrocnemius muscle")] },
  { id: "ft-calf-1", name: "单脚提踵", cat: "小腿", muscles: ["gastroc_med", "gastroc_lat"], secondary: ["soleus", "peroneals", "foot_intrinsic"],
    demo: { steps: ["单脚站在台阶边缘，手轻扶墙保持平衡", "前脚掌下压，脚跟抬到最高", "顶端停 1 秒", "慢慢放下到脚跟略低于台阶"] },
    tips: ["骨盆保持水平", "脚踝不向外倒"], mistakes: ["扶手用力过多", "幅度只做一半"],
    level: "中级", progress: "扶墙 → 不扶 → 手持哑铃", dose: { sets: 3, amount: 12, unit: "次" }, restSec: 60,
    sources: ["ExRx Single Leg Calf Raise (exrx.net/WeightExercises/Gastrocnemius/BWSingleLegCalfRaise)", K("Soleus muscle")] },
  { id: "ft-band-df", name: "弹力带踝背屈与跖屈", cat: "踝关节", muscles: ["tibialis", "soleus"], secondary: ["gastroc_med", "gastroc_lat"],
    demo: { steps: ["坐姿伸腿，弹力带套在前脚掌", "背屈：带子固定在前方，脚尖向自己勾回", "跖屈：双手拉住带子，脚尖向前踩出", "每个方向慢速往返"] },
    tips: ["只动踝关节，膝和髋不动", "回程比发力慢"], mistakes: ["用脚趾代偿而不是踝关节", "带子太紧导致幅度变小"],
    level: "入门", progress: "轻阻力 → 中阻力 → 站姿脚跟走路（背屈）", dose: { sets: 2, amount: 15, unit: "次" }, restSec: 45,
    sources: [K("Tibialis anterior muscle"), K("Soleus muscle")] },
  { id: "ft-towel", name: "毛巾抓握", cat: "足部与足弓", muscles: ["foot_intrinsic"], secondary: ["tibialis"],
    demo: { steps: ["坐姿，脚掌平放在铺开的毛巾上", "脚趾弯曲把毛巾向自己抓拢", "放松后重复，直到毛巾收完"] },
    tips: ["脚跟不离地", "动作慢而完整"], mistakes: ["只用大脚趾", "抽筋时仍硬做"],
    level: "入门", progress: "空毛巾 → 毛巾上放小重物 → 站姿", dose: { sets: 2, amount: 10, unit: "次" }, restSec: 45, sources: [MCKEON, K("Flexor digitorum brevis muscle")] },
  { id: "ft-toe-pick", name: "脚趾抓取", cat: "足部与足弓", muscles: ["foot_intrinsic"], secondary: [],
    demo: { steps: ["坐姿，地上放弹珠或小毛巾卷", "用脚趾夹起放进旁边的碗里", "左右脚交替"] },
    tips: ["每次夹稳再移动"], mistakes: ["用脚踝甩动代替脚趾"],
    level: "入门", progress: "大物件 → 小物件 → 站姿", dose: { sets: 2, amount: 10, unit: "次" }, restSec: 45, sources: [MCKEON] },
  { id: "ft-short-foot", name: "短足练习（short foot）", cat: "足部与足弓", muscles: ["foot_intrinsic"], secondary: ["tibialis"],
    demo: { steps: ["坐姿或站姿，脚掌平放", "脚趾保持放松平直，把前脚掌向脚跟方向\u201c缩短\u201d", "足弓抬起，保持 5–10 秒", "放松后重复"] },
    tips: ["脚趾不要弯曲抓地", "大脚趾球不离地"], mistakes: ["用脚趾抓地代替收缩足弓", "脚踝向外翻"],
    level: "入门→中级", progress: "坐姿 → 双脚站 → 单脚站 → 动态动作中保持", dose: { sets: 3, amount: 8, unit: "次" }, restSec: 45, sources: [MCKEON, K("Abductor hallucis muscle")] },
  { id: "ft-inv-ev", name: "踝内翻/外翻（弹力带）", cat: "踝关节", muscles: ["peroneals"], secondary: ["tibialis"],
    demo: { steps: ["坐姿，弹力带一端固定在侧方，套住前脚掌", "外翻：脚底向外转，对抗带子", "内翻：换方向固定，脚底向内转", "慢速往返"] },
    tips: ["小腿不转动，只转脚掌", "回程控制"], mistakes: ["用髋部转动代偿"],
    level: "入门", progress: "轻阻力 → 中阻力", dose: { sets: 2, amount: 15, unit: "次" }, restSec: 45, sources: [K("Peroneus longus muscle"), K("Tibialis posterior muscle")] },
  { id: "ft-balance", name: "单脚平衡", cat: "踝关节", muscles: ["peroneals", "foot_intrinsic"], secondary: ["glute_med", "tibialis", "soleus"],
    demo: { steps: ["单脚站立，膝关节微屈", "保持骨盆水平、目视前方", "坚持到设定时间后换脚"] },
    tips: ["身边有可扶物", "脚趾放松，用足底三点支撑"], mistakes: ["支撑腿膝内扣", "憋气"],
    level: "入门", progress: "睁眼 → 闭眼 → 软垫 → 加上肢动作", dose: { sets: 3, amount: 30, unit: "秒" }, restSec: 30, sources: [BAL] },
];
const DOSE_KEY = "fk-foot-dose-v1";
export type Dose = { sets: number; amount: number; restSec: number };
export function loadDose(id: string): Dose { const e = FOOT_LIBRARY.find(x => x.id === id)!; let s: Record<string, Dose> = {}; try { s = JSON.parse(localStorage.getItem(DOSE_KEY) || "{}"); } catch { /* keep default */ } return s[id] ?? { sets: e.dose.sets, amount: e.dose.amount, restSec: e.restSec }; }
export function saveDose(id: string, d: Dose) { let s: Record<string, Dose> = {}; try { s = JSON.parse(localStorage.getItem(DOSE_KEY) || "{}"); } catch { /* reset only broken store */ } s[id] = d; localStorage.setItem(DOSE_KEY, JSON.stringify(s)); }
