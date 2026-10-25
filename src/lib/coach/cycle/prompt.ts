import { cycleCourseLines } from "./display";
import type { CycleDraft } from "./planner";
/** Versioned bounded prompt contract. Never invokes a model or grants calendar authority. */
export const CYCLE_PROMPT_VERSION = "FK_CYCLE_PROMPT_1";
export const CYCLE_EXAMPLES = [
  {
    family: "MIDDLE",
    condition: "800米目标；近期有速度课，但后续执行困难",
    response:
      "事实引用实际分段与反馈；竞争解释为剂量/配速分配和恢复/时间；保留反证；只提出一个可确认调整，不从目标成绩虚构课速。",
  },
  {
    family: "SPRINT",
    condition: "400米目标；速度技术经验尚未确认",
    response:
      "先组织动作与熟悉速度课程的条件草案；不套马拉松周跑量，不安排最大测试；缺实际剂量则标未知。",
  },
  {
    family: "DISTANCE",
    condition: "长距离目标；饮食只记录部分餐次",
    response: "按实际课程类型提示补给核对；不把部分摄入当全天不足，不计算虚构热量缺口。",
  },
  {
    family: "SAFETY",
    condition: "设备准备度高，但疼痛加重或功能受限",
    response: "先暂停诱发症状内容并复核，不能放行、诊断或自动解除限制；候选安排仍需用户确认。",
  },
] as const;
export function cyclePrompt(d: CycleDraft) {
  const examples = CYCLE_EXAMPLES.filter(
    (x) => x.family === d.family || x.family === "SAFETY",
  ).slice(0, 2);
  return [
    `${CYCLE_PROMPT_VERSION}：你协助解释宿主已经计算的个体周期草案。`,
    "可信事实→确定性计算→相关参考→两种竞争解释→支持与反证→未知→具体候选→用户确认→后续反馈修订。只给简短依据说明，不要求暴露内部思维过程。",
    "目标、未来计划、实测和假设必须分开；引用现有ID，不生成事实/审批ID。缺项保持未知，最多追问两项，回答最多1000字。",
    "不得更改宿主日期、轮次、剂量、强度或安全限制；不得声称已经写入。所有计划变更由宿主复核并经用户确认。不得以HRV/设备分数放行，不诊断或给组织恢复率。",
    `已核对草案：${d.version}，${d.family}；安全${d.hold ? "限制生效" : "未见已知限制（不等于医学放行）"}；${d.weeks
      .slice(0, 4)
      .map((w) => `${w.start}:${w.phase}`)
      .join("；")}；候选仍有条件。`,
    `最近一周候选（未执行）：${
      d.weeks[0]?.sessions
        .filter((s) => s.candidate)
        .slice(0, 3)
        .map(
          (s) =>
            `${s.date}新增${s.candidate!.title} ${s.candidate!.minutes}分钟；${cycleCourseLines(s.candidate!).join("；")}`,
        )
        .join("\n") || "条件不足，暂无可执行课"
    }`,
    ...examples.map((x) => `对照案例：${x.condition}\n合适回答：${x.response}`),
    `本轮缺项：${d.unknowns.slice(0, 3).join("；") || "仍需核对个体响应"}`,
  ]
    .join("\n")
    .slice(0, 1800);
}
export const CYCLE_SOURCES = [
  {
    id: "HAUGEN_2021",
    title: "800/1500米训练科学与实践整合（2021）",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8363530/",
    scope: "世界级中跑训练的综述与实践资料",
    limit: "群体/精英训练特点不直接复制为个人剂量，不能从目标推断能力",
  },
  {
    id: "HAUGEN_2019",
    title: "短跑训练与发展（2019）",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6872694/",
    scope: "短跑科学与实践整合",
    limit: "100米为主，不能未经核对套用到400米及普通用户",
  },
  {
    id: "HAUGEN_2022",
    title: "世界级长跑训练特点（2022）",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8975965/",
    scope: "精英长跑训练组织的综述",
    limit: "不据此设置所有人的周跑量或强度比例",
  },
  {
    id: "TAPER_2023",
    title: "耐力运动员减量系统综述与荟萃分析（2023）",
    url: "https://pubmed.ncbi.nlm.nih.gov/37163550/",
    scope: "耐力比赛减量的群体证据",
    limit: "不能证明本产品的固定窗口、减量规则或某个人的效果",
  },
] as const;
