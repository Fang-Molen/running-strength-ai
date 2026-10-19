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
  /** 面向用户的教练话术：先结论，再原因，再怎么用，最后说做什么测试来确认对你是否适用。 */
  coach?: { conclusion: string; why: string; use: string; test: string };
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
    coach: { conclusion: '同样是 400米×8，休 1 分钟和休 8 分钟是两种不同的课：短休练乳酸耐受/速度耐力（不完全恢复），长休练速度质量/比赛配速（接近完全恢复）。', why: '休息长短决定下一组开始时的身体状态。休 1 分钟时心率和血乳酸还没降下来，后几组是带着酸跑，练的是缓冲和清除乳酸、带疲劳维持速度，配速只能到比赛配速的 85–90%；休 8 分钟磷酸原基本恢复，每组都能跑到接近比赛配速，练的是高速跑姿、步频和神经肌肉募集。', use: '400 米两种都要：离比赛远时以短休/中休速度耐力为主，每周 1 次；赛前 4–6 周加入长休比赛配速课，每周 1 次；两种课至少隔 48 小时。长休那节每组差超过 1.5 秒就停。', test: '做一次 300 米全力计时，隔 10 分钟再跑一次 300 米，记两次成绩：第二次慢超过 2 秒说明速度耐力是短板，多练短休；差得少但都慢，说明绝对速度是短板，多练长休快跑。' },
  };
  if ((/轻松跑|慢跑|有氧跑|持续跑/.test(q) && /冲刺|短跑|全速|高速跑/.test(q)) && /区别|不同|本质|关系|为什么|训练/.test(q)) return {
    kind: 'STIMULUS_SPECIFICITY',
    observation: '持续低强度跑与高速度短跑在持续时间、动作速度、机械应力和代谢需求上不同。',
    plausibleMechanism: '持续跑更偏向支持氧化代谢及其长期适应；高速短跑更加要求高速下的神经肌肉协调和施力能力，两者都依赖多个身体系统。',
    missingEvidence: ['实际训练速度、距离与持续时间', '当前专项目标、训练经历与恢复记录'],
    conclusionLimit: '不能仅凭训练名称推定个人心肺、肌肉或神经适应，更不能将两类训练的负荷直接等价。',
    coach: { conclusion: '轻松跑练的是有氧底座，冲刺练的是速度和神经肌肉，两者不能互相替代。', why: '轻松跑持续时间长、强度低，主要刺激线粒体、毛细血管和脂肪供能，帮助恢复和后程耐受；冲刺只有几秒，靠磷酸原供能，刺激的是高速下的发力、步频和肌腱刚度。', use: '400 米训练里，轻松跑每周 2–3 次做底座和恢复；冲刺/加速跑每周 1–2 次放在状态好的日子、充分热身后做，组间休够 2–4 分钟保证每次都是高质量。', test: '每 3–4 周测一次 60 米或 150 米计时，同时看轻松跑同配速下心率是否下降，就能分别知道速度和有氧有没有在进步。' },
  };
  if (/训练的本质|训练本质|所有训练.*(?:联系|共同|逻辑|原理)|(?:神经|肌肉).*(?:心脏|心肺|呼吸).*(?:联系|协同|影响)/.test(q)) return {
    kind: 'GENERAL_ADAPTATION',
    observation: '训练处方由目标、刺激形式、实际剂量、个体状态及恢复条件共同决定。',
    plausibleMechanism: '神经控制、肌肉与肌腱、心血管和呼吸供氧、ATP再合成等系统共同参与运动；训练后的适应既有专项性也有个体差异。',
    missingEvidence: ['训练目标与完整处方', '个体训练历史及实际表现', '恢复、疼痛与可比的后续测量'],
    conclusionLimit: '某个系统改善不等于目标项目成绩必然改善；只有长期可比证据才支持个人适应判断。',
    coach: { conclusion: '训练的本质是：给身体一个它暂时应付不了的刺激，再给足恢复，让它变得更强；神经、肌肉、心肺是一起被训练的。', why: '跑得快首先靠神经快速募集肌肉、肌腱高效传力；能坚持住靠心肺供氧和能量系统再合成 ATP。练哪个系统取决于强度、时长和休息，恢复不够时适应反而停滞。', use: '每周安排要有明确分工：1–2 次速度/专项课、1 次力量、2–3 次轻松有氧，难课之间隔 48 小时。', test: '固定每 3–4 周做同一组测试（如 150 米计时 + 同配速轻松跑心率），对比就能看出哪方面在进步。' },
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
    coach: { conclusion: '同一天先冲刺后深蹲可以，但第二节要减量；反过来先深蹲再冲刺不推荐。', why: '冲刺和大重量深蹲都大量调用下肢快肌和神经系统，前一节的疲劳会让后一节质量下降、受伤风险上升；先做速度能保证冲刺质量。', use: '上午冲刺、下午力量时，两节至少隔 4–6 小时；力量课把组数减 1/3、重量不超过平时的 85%；第二天安排轻松跑或休息。', test: '下午力量课第一组记下杠铃速度或 RPE，比平时高 1 以上就只做一半组数；第二天记一下腿沉程度。' },
    };
    return {
      kind: 'STRENGTH_TRANSFER',
      observation: '最大力量的变化与专项跑步成绩是不同的测量结果，不能直接相互替代。',
      plausibleMechanism: '力量训练可能改善潜在施力能力，但跑步成绩还取决于高速触地条件下的力学应用、技术、速度训练、体重、恢复及测试条件。',
      missingEvidence: ['可比的专项计时及分段', '力量测试方法、训练计划与体重变化', '相同条件下的跑步技术和恢复记录'],
      conclusionLimit: '力量提高与专项进步之间不能直接建立个人因果关系；不能据此自动加负荷。',
    coach: { conclusion: '深蹲变强不等于 400 米自动变快，力量要通过专项速度课“转化”出来。', why: '深蹲提高的是慢速下的最大力量；400 米要在 0.1 秒左右的触地时间里把力量用出来，还要配合跑姿和速度耐力。中间缺的是爆发力和专项速度这一环。', use: '保持每周 1–2 次力量，同时加入跳跃（跳箱、立定跳远）和加速跑，让最大力量变成快速力量；临近比赛降低力量量、保留强度。', test: '每 3–4 周同时测一次深蹲（或立定跳远）和 30 米/150 米计时：力量涨了但计时没变，就该加爆发力和速度课比重。' },
    };
  }
  return null;
}

/** 用户看到的教练回答：结论 → 为什么 → 怎么用 → 测什么来确认。 */
export function formatTrainingMechanism(m: TrainingMechanism): string {
  if (m.coach) return `结论：${m.coach.conclusion}\n为什么：${m.coach.why}\n怎么用：${m.coach.use}\n想知道你自己适合哪种：${m.coach.test}`;
  return formatTrainingMechanismAudit(m);
}
/** 内部依据格式（审计/测试用，不直接展示给用户）。 */
export function formatTrainingMechanismAudit(m: TrainingMechanism): string {
  return `训练共通原理（非个人能力诊断）：\n事实与概念：${m.observation}\n可能机制：${m.plausibleMechanism}\n还需证据：${m.missingEvidence.join('；')}。\n判断边界：${m.conclusionLimit}\n个人适应结论：UNKNOWN。`;
}
