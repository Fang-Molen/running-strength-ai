/**
 * Shared exercise-science concepts for local, evidence-bounded explanations.
 * Not a physiological measurement, diagnosis, athlete score, or prescription.
 * Pure, offline, read-only; retains UNKNOWN for individual adaptation.
 */
export type TrainingMechanism = {
  kind: 'GENERAL_ADAPTATION' | 'INTERVAL_RECOVERY' | 'STRENGTH_TRANSFER' | 'CONCURRENT_STRESS' | 'STIMULUS_SPECIFICITY';
  observation: string;
  plausibleMechanism: string;
  missingEvidence: string[];
  conclusionLimit: string;
};

export function explainTrainingMechanism(question: string): TrainingMechanism | null {
  const q = question.trim().toLowerCase();
  if (q.length === 0) return null;
  const asksWhy = /为什么|为何|区别|不同|联系|影响|关系|会不会|能不能|是否|怎么|如何|本质|原理/.test(q);
  if (!asksWhy) return null;
  const hasIntervals = /间歇|重复跑|组间|400\s*(?:米|m)?\s*[×x*]\s*\d+|200\s*(?:米|m)?\s*[×x*]\s*\d+/.test(q);
  const hasRest = /休息|恢复|间隔|密度|短间歇|长间歇/.test(q);
  if (hasIntervals && hasRest) return {
    kind: 'INTERVAL_RECOVERY',
    observation: '相同跑段距离和组数，不代表相同训练刺激；恢复时间会改变下一组开始时的状态。',
    plausibleMechanism: '较短恢复通常使后续重复段在更不充分的恢复下进行；充分恢复更有利于维持较高跑速与动作质量。具体适应还受实际速度、总量和个体水平影响。',
    missingEvidence: ['每组实际距离与用时', '准确的组间恢复时间', '训练目的、训练经历及训练后反应'],
    conclusionLimit: '不能仅凭组数或休息长度确定能量系统贡献、训练负荷、个人适应或下次处方。',
  };
  if ((/轻松跑|慢跑|有氧跑|持续跑/.test(q) && /冲刺|短跑|全速|高速跑/.test(q)) && /区别|不同|本质|关系|为什么|训练/.test(q)) return {
    kind: 'STIMULUS_SPECIFICITY',
    observation: '持续低强度跑与高速度短跑在持续时间、动作速度、机械应力和代谢需求上不同。',
    plausibleMechanism: '持续跑更偏向支持氧化代谢及其长期适应；高速短跑更加要求高速下的神经肌肉协调和施力能力，两者都依赖多个身体系统。',
    missingEvidence: ['实际训练速度、距离与持续时间', '当前专项目标、训练经历与恢复记录'],
    conclusionLimit: '不能仅凭训练名称推定个人心肺、肌肉或神经适应，更不能将两类训练的负荷直接等价。',
  };
  if (/训练的本质|训练本质|所有训练.*(?:联系|共同|逻辑|原理)|(?:神经|肌肉).*(?:心脏|心肺|呼吸).*(?:联系|协同|影响)/.test(q)) return {
    kind: 'GENERAL_ADAPTATION',
    observation: '训练处方由目标、刺激形式、实际剂量、个体状态及恢复条件共同决定。',
    plausibleMechanism: '神经控制、肌肉与肌腱、心血管和呼吸供氧、ATP再合成等系统共同参与运动；训练后的适应既有专项性也有个体差异。',
    missingEvidence: ['训练目标与完整处方', '个体训练历史及实际表现', '恢复、疼痛与可比的后续测量'],
    conclusionLimit: '某个系统改善不等于目标项目成绩必然改善；只有长期可比证据才支持个人适应判断。',
  };
  const strength = /深蹲|硬拉|力量|最大力量|1rm|卧推|跳跃/.test(q);
  const running = /跑步|冲刺|短跑|400米|800米|速度|成绩|专项表现/.test(q);
  if (strength && running) {
    if (/一起|同天|上午|下午|叠加|连续|安排|冲突|疲劳|影响恢复/.test(q)) return {
      kind: 'CONCURRENT_STRESS',
      observation: '冲刺、跳跃和高负荷力量训练可能在同一时期对部分下肢组织及神经肌肉功能提出较高要求。',
      plausibleMechanism: '训练顺序、间隔、实际强度和既往耐受会影响疲劳叠加和下一次训练质量；不能仅凭训练名称推算恢复时间。',
      missingEvidence: ['训练日程和两课间隔', '速度、重量、组数及RPE', '疼痛、恢复和近期同类训练响应'],
      conclusionLimit: '不能直接诊断神经疲劳、组织损伤，也不能自动删改其中一节课。',
    };
    return {
      kind: 'STRENGTH_TRANSFER',
      observation: '最大力量的变化与专项跑步成绩是不同的测量结果，不能直接相互替代。',
      plausibleMechanism: '力量训练可能改善潜在施力能力，但跑步成绩还取决于高速触地条件下的力学应用、技术、速度训练、体重、恢复及测试条件。',
      missingEvidence: ['可比的专项计时及分段', '力量测试方法、训练计划与体重变化', '相同条件下的跑步技术和恢复记录'],
      conclusionLimit: '力量提高与专项进步之间不能直接建立个人因果关系；不能据此自动加负荷。',
    };
  }
  return null;
}

export function formatTrainingMechanism(m: TrainingMechanism): string {
  return `训练共通原理（非个人能力诊断）：\n事实与概念：${m.observation}\n可能机制：${m.plausibleMechanism}\n还需证据：${m.missingEvidence.join('；')}。\n判断边界：${m.conclusionLimit}\n个人适应结论：UNKNOWN。`;
}
