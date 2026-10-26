import { TRAINING_MODEL_EVIDENCE, TRAINING_MODEL_KNOWLEDGE_VERSION, type DecisionPermission } from './evidence'
import type { MethodId, EventFocus } from './types'

export interface TrainingDecisionKnowledge {
 id:string;version:typeof TRAINING_MODEL_KNOWLEDGE_VERSION;permission:DecisionPermission
 sourceIds:readonly string[];conditions:readonly string[];conclusions:readonly string[];limits:readonly string[]
 automaticPrescription:false
}
export const TRAINING_DECISION_KNOWLEDGE:readonly TrainingDecisionKnowledge[]=[
 {id:'distribution-comparison',version:TRAINING_MODEL_KNOWLEDGE_VERSION,permission:'PRINCIPLE',sourceIds:['TID-SEILER-2006','TID-FILIPAS-2022'],conditions:['先区分按时间分区与课次目标口径；结合专项、阶段和实际耐受。'],conclusions:['金字塔与极化都是可比较的阶段安排；阈值导向描述中强度较多的分布。'],limits:['没有通用最优分布。','本目录未收录足以比较阈值导向优势的直接研究，不能据标签增加阈值量。'],automaticPrescription:false},
 {id:'organization-comparison',version:TRAINING_MODEL_KNOWLEDGE_VERSION,permission:'PRINCIPLE',sourceIds:['DOUBLE-TALSNES-2024','INTERVAL-BUCHHEIT-2013'],conditions:['须核对既有单课、双课耐受及阈值控制；块状组织另需跨周负荷和恢复记录。'],conclusions:['单阈值、双阈值与块状训练是课次或周期组织，能与不同强度分布组合。'],limits:['双阈值急性反应不等于长期优越性。','本目录没有块状训练优越性的直接证据；只列研究比较，不创建训练块。'],automaticPrescription:false},
 {id:'cs-existing-calculation',version:TRAINING_MODEL_KNOWLEDGE_VERSION,permission:'VERIFIED_CALCULATION',sourceIds:['CS-RAINSBERGER-2026','INTENSITY-JAMNICK-2020'],conditions:['由既有 ABIL_CS 实现及最大努力同协议测试门控产生。'],conclusions:['保留距离–时间 OLS 的 CS 模型估计及来源。'],limits:['算术检查不构成生理效度验证；上述文献约束解释，不认证代码。','不把 CS 换算为实测 LT2。'],automaticPrescription:false},
 {id:'vdot-existing-calculation',version:TRAINING_MODEL_KNOWLEDGE_VERSION,permission:'VERIFIED_CALCULATION',sourceIds:['VDOT-DANIELS-1979'],conditions:['仅既有生理模块接受的连续比赛输入；保留公式版本。'],conclusions:['VDOT 作为表现参考指数。'],limits:['不生成阈值、训练配速或精确专项预测。'],automaticPrescription:false},
 {id:'purpose-response-hypothesis',version:TRAINING_MODEL_KNOWLEDGE_VERSION,permission:'ATHLETE_HYPOTHESIS',sourceIds:['INTERVAL-BUCHHEIT-2013','CONCURRENT-SCHUMANN-2022'],conditions:['实际训练和后续反应须同一运动员、同协议并保留版本；先执行疼痛、医学与功能安全门控。'],conclusions:['同样的酸痛或主观疲劳，对轻松跑与速度课的决策相关性不同。','允许在原已批准且不诱发症状的课程上观察，不新加试探剂量。'],limits:['候选门控是保守产品规则，未经个人效果验证。','HRV、恢复曲线或无痛自报不提供医学许可。'],automaticPrescription:false},
 {id:'block-research-only',version:TRAINING_MODEL_KNOWLEDGE_VERSION,permission:'RESEARCH_ONLY',sourceIds:[],conditions:['需补充针对项目和人群的直接研究及个体执行资料。'],conclusions:['可保留块状组织作为研究比较问题。'],limits:['缺直接来源，不能进入新课表或新增刺激。'],automaticPrescription:false},
]

export const METHOD_SOURCE_IDS:Record<MethodId,readonly string[]>={
 PYRAMIDAL:['TID-SEILER-2006','TID-FILIPAS-2022'],POLARIZED:['TID-SEILER-2006','TID-FILIPAS-2022'],
 THRESHOLD_ORIENTED:['INTENSITY-JAMNICK-2020','LT-JAMNICK-2018'],
 SINGLE_THRESHOLD:['INTERVAL-BUCHHEIT-2013','LT-JAMNICK-2018'],DOUBLE_THRESHOLD:['DOUBLE-TALSNES-2024'],
 BLOCK:[],EVENT_SPECIFIC:['EVENT-SPENCER-2001','INTERVAL-BUCHHEIT-2013','CONCURRENT-SCHUMANN-2022'],
}
export const EVENT_PRIORITIES:Record<EventFocus,readonly string[]>={
 '400':['既有速度、速度耐力与力量/爆发力安排','原批准课的重复质量、组休及动作功能'],
 '800':['速度与有氧支持并行的专项目标','实际速度保持、专项耐力和力量冲突'],
 '1500':['有氧支持、专项配速耐力与速度储备','同协议专项表现、关键课质量及恢复'],
 LONG_DISTANCE:['持续跑表现与可承受的低强度基础','阈值和高强度刺激的阶段安排与补给恢复'],
 OTHER:['先明确专项需求和实际比赛/测试协议'],UNKNOWN:['先补目标项目与当前阶段'],
}
export function knowledgeForMethod(method:MethodId){return TRAINING_MODEL_EVIDENCE.filter(source=>METHOD_SOURCE_IDS[method].includes(source.id))}
export function trainingDecisionEvidencePolicy(){return {version:TRAINING_MODEL_KNOWLEDGE_VERSION,sources:TRAINING_MODEL_EVIDENCE,rules:TRAINING_DECISION_KNOWLEDGE,scientificallyValidated:false as const,automaticPrescription:false as const}}
