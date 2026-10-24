/**
 * Public scientific/method sources informing conservative product boundaries.
 * This catalog does not approve a training prescription or validate this software.
 * App authorization, athlete facts and runtime safety gates remain independent.
 */
export interface TrainingModelEvidence {
  readonly id: string
  readonly status: 'EVIDENCE_INFORMED'
  readonly title: string
  readonly authors: readonly string[]
  readonly publicationYear: number
  readonly firstOnlineYear?: number
  readonly doi: string | null
  readonly urls: readonly string[]
  readonly studyType: string
  readonly population: string
  readonly sampleSize: number | null
  readonly verification: {
    readonly checkedOn: string
    readonly scope: string
    readonly note: string
  }
  readonly supports: readonly string[]
  readonly limitations: readonly string[]
  readonly codingConstraints: readonly string[]
}

export const TRAINING_MODEL_EVIDENCE = [
  {
    id: 'TID-SEILER-2006',
    status: 'EVIDENCE_INFORMED',
    title: 'Quantifying training intensity distribution in elite endurance athletes: is there evidence for an “optimal” distribution?',
    authors: ['K. Stephen Seiler', 'Glenn Øvrevik Kjerland'],
    publicationYear: 2006,
    doi: '10.1111/j.1600-0838.2004.00418.x',
    urls: ['https://pubmed.ncbi.nlm.nih.gov/16430681/', 'https://doi.org/10.1111/j.1600-0838.2004.00418.x'],
    studyType: 'Observational training-intensity quantification',
    population: '11名男性国家级青年越野滑雪运动员；连续32天；主要分布比较分析318次耐力训练。',
    sampleSize: 11,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_ABSTRACT', note: '核验PubMed摘要、研究人群、观察时段及分析会次数；非随机训练方案比较。' },
    supports: ['该群体呈低强度为主、较少中强度及一定高强度的分布。', '训练分布必须结合分区锚点与量化口径解释。'],
    limitations: ['滑雪青年男性观察结果不能成为所有跑者的最优配比。', '不能混用逐分钟、训练会次和工作段口径解释80/20。'],
    codingConstraints: ['分布保留TIME_IN_ZONE或SESSION_GOAL口径、观察窗口、完整性和未知覆盖。', '不按精英或普通标签硬选极化/金字塔；不强制80/20。', '力量与短冲刺不能仅靠心率强行归入耐力分区。'],
  },
  {
    id: 'TID-FILIPAS-2022',
    status: 'EVIDENCE_INFORMED',
    title: 'Effects of 16 weeks of pyramidal and polarized training intensity distributions in well-trained endurance runners',
    authors: ['L. Filipas', 'M. Bonato', 'G. Gallo', 'R. Codella'],
    publicationYear: 2022,
    firstOnlineYear: 2021,
    doi: '10.1111/sms.14101',
    urls: ['https://pubmed.ncbi.nlm.nih.gov/34792817/', 'https://air.unimi.it/handle/2434/884104', 'https://air.unimi.it/retrieve/dfa8b9a8-e1c5-748b-e053-3a05fe0a3a96/sms.14101.pdf'],
    studyType: 'Four-arm randomized controlled training trial',
    population: '60名训练良好的男性跑者，38±7岁、VO2peak 67±4 mL/kg/min；16周PYR、POL及两种8周转换序列。',
    sampleSize: 60,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_FULL_TEXT', note: '核验大学机构库摘要及公开论文PDF的方法、结果和外推限制。' },
    supports: ['四种方案均改善跑步表现；该试验中PYR→POL的5公里改善较大。', '分布可以随周期变化，选择不能只依据运动水平名称。'],
    limitations: ['单项男性训练者试验不覆盖初学者、女性或400/800专项。', '约1.5%的组平均5公里改善不能作为个人收益保证。', '8周转换及3+1周安排为试验设计，不是通用最优周期。'],
    codingConstraints: ['PYRAMIDAL与POLARIZED均作为阶段候选，不自动指定首选。', '结合目标、阶段、既往负荷耐受、恢复和可用时间；区分计划与实际分布。', '不把组平均收益或固定周期写成个人预测。'],
  },
  {
    id: 'DOUBLE-TALSNES-2024',
    status: 'EVIDENCE_INFORMED',
    title: 'Comparison of acute physiological responses between one long and two short sessions of moderate-intensity training in endurance athletes',
    authors: ['Rune Kjøsen Talsnes', 'Per-Øyvind Torvik', 'Knut Skovereng', 'Øyvind Sandbakk'],
    publicationYear: 2024,
    doi: '10.3389/fphys.2024.1428536',
    urls: ['https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2024.1428536/full', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11319183/'],
    studyType: 'Acute counterbalanced crossover trial',
    population: '14名受训男性耐力运动员：11名越野滑雪者、3名跑者；实验室上坡跑，6×10分钟对比两次3×10分钟、相隔6.5小时。',
    sampleSize: 14,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_FULL_TEXT', note: '核验出版方全文；外部时长和强度匹配，测量的是急性生理和感知反应。' },
    supports: ['分拆条件下部分心率、乳酸、RPE和恢复负担较低。', '双阈值已有直接急性实验，不能表述为完全没有实验依据。'],
    limitations: ['急性负荷反应不能证明长期成绩、适应或伤病优势。', '样本小、全男性、多数非跑者且为上坡协议。', '研究的6.5小时和乳酸/速度协议不是普适准入线。'],
    codingConstraints: ['不自动增加第二课；须有明确启用、个体阈值依据、既有耐受及恢复监测条件。', '双阈值是同日安排方式，不能与极化/金字塔当成互斥类别。', '不复制精英周跑量、不承诺增益或降低伤病。'],
  },
  {
    id: 'EVENT-SPENCER-2001',
    status: 'EVIDENCE_INFORMED',
    title: 'Energy system contribution during 200- to 1500-m running in highly trained athletes',
    authors: ['M. R. Spencer', 'P. B. Gastin'],
    publicationYear: 2001,
    doi: '10.1097/00005768-200101000-00024',
    urls: ['https://pubmed.ncbi.nlm.nih.gov/11194103/', 'https://doi.org/10.1097/00005768-200101000-00024'],
    studyType: 'Laboratory event-simulation physiology study',
    population: '20名澳大利亚国家级运动员；200/400/800/1500米专项分别3/6/5/6人；跑台模拟、累计氧亏法。',
    sampleSize: 20,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_ABSTRACT', note: '核验PubMed摘要的样本、方法和项目间结果；未声称核验付费全文。' },
    supports: ['400、800和1500米均有显著有氧贡献，项目间贡献随持续时间变化。'],
    limitations: ['小样本跑台模拟的组平均能量贡献不能当作个人比例。', '项目能量贡献不是训练时间配比或个人能力分型。'],
    codingConstraints: ['专项层展示真实连续比赛/测试成绩、平均速度、分段及可比较的速度保持率。', '不同距离不互相充当精确比赛预测。', '不输出个人有氧/无氧百分比、肌纤维类型或无氧容量诊断。'],
  },
  {
    id: 'INTERVAL-BUCHHEIT-2013',
    status: 'EVIDENCE_INFORMED',
    title: 'High-intensity interval training, solutions to the programming puzzle: Part I: cardiopulmonary emphasis',
    authors: ['Martin Buchheit', 'Paul B. Laursen'],
    publicationYear: 2013,
    doi: '10.1007/s40279-013-0029-x',
    urls: ['https://pubmed.ncbi.nlm.nih.gov/23539308/', 'https://martin-buchheit.net/wp-content/uploads/2018/01/buchheit-laursen-hit-solutions-to-the-programming-puzzle-part-i.pdf'],
    studyType: 'Narrative methods/programming review',
    population: '综述多项目间歇训练研究；非单项干预，无单一新样本量。',
    sampleSize: null,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_ABSTRACT_AND_AUTHOR_COPY_URL', note: '核验公开摘要、DOI及作者公开论文入口；不作为特定间歇成绩预测的验证集。' },
    supports: ['工作时长/强度、恢复时长/方式、组间恢复和总量共同影响间歇训练反应。'],
    limitations: ['通用编程综述不提供由重复跑均速推算个人比赛成绩的有效模型。', '课表外负荷不能独立确认VO2max刺激、乳酸耐受或无氧容量。'],
    codingConstraints: ['保存工作距离/时长、重复次数、恢复时长/方式、组数和组间恢复。', '缺恢复信息时只描述已知外负荷并提示证据不足。', '不累加间歇生成连续比赛或阈值；不把工作均速当作全课均速。'],
  },
  {
    id: 'LT-JAMNICK-2018',
    status: 'EVIDENCE_INFORMED',
    title: 'Manipulating graded exercise test variables affects the validity of the lactate threshold and V̇O2peak',
    authors: ['Nicholas A. Jamnick', 'Javier Botella', 'David B. Pyne', 'David J. Bishop'],
    publicationYear: 2018,
    doi: '10.1371/journal.pone.0199794',
    urls: ['https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0199794', 'https://pubmed.ncbi.nlm.nih.gov/30059543/'],
    studyType: 'Repeated-measures test-protocol and method comparison',
    population: '17名受训男性自行车运动员；1/3/4/7/10分钟级长，14种LT算法，与系列30分钟恒定功率MLSS比较。',
    sampleSize: 17,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_FULL_TEXT', note: '核验PLOS全文的测试协议、14种方法及MLSS操作定义。' },
    supports: ['级长和识别算法影响乳酸阈值；固定4 mmol/L不是个人MLSS定义。', '重复恒定负荷MLSS测试与递增测试乳酸转折不是同一种测量。'],
    limitations: ['自行车小样本优选算法不能直接成为跑步统一标准。', '相关性高或组平均相近不代表个体阈值可互换。'],
    codingConstraints: ['阈值保留marker、method、protocolKey、testId、日期、运动方式及单位。', '同类阈值趋势只在可比较协议内解释，不静默覆盖异协议结果。', '不默认LT1=2 mmol/L、LT2=4 mmol/L，不改写既有实测HR路径。'],
  },
  {
    id: 'INTENSITY-JAMNICK-2020',
    status: 'EVIDENCE_INFORMED',
    title: 'An Examination and Critique of Current Methods to Determine Exercise Intensity',
    authors: ['Nicholas A. Jamnick', 'Robert W. Pettitt', 'Cesare Granata', 'David B. Pyne', 'David J. Bishop'],
    publicationYear: 2020,
    doi: '10.1007/s40279-020-01322-8',
    urls: ['https://link.springer.com/article/10.1007/s40279-020-01322-8', 'https://pubmed.ncbi.nlm.nih.gov/32729096/'],
    studyType: 'Critical methodological review',
    population: '运动强度测定与强度域构念效度综述；无单一新样本量。',
    sampleSize: null,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_PUBLISHER_ABSTRACT', note: '核验出版方公开摘要和方法背景，未声称读取订阅全文。' },
    supports: ['LT1/GET/VT可作为moderate–heavy边界依据；固定最大锚点百分比不能保证同一强度域。', 'CS/CP与递增试验的LT2、RCP、MLSS等不能仅凭术语当成同一测量。'],
    limitations: ['生理强度域效度不等于长期训练策略的优越性。', '该综述不验证本软件或其保守门槛。'],
    codingConstraints: ['LT1、LT2、VT1、VT2/RCP、MLSS、CS按来源分别保存和展示。', '不把固定HRmax百分比、VDOT或CS冒充实测乳酸/通气阈值。', '证据不足时返回未知，不补造阈值。'],
  },
  {
    id: 'CS-RAINSBERGER-2026',
    status: 'EVIDENCE_INFORMED',
    title: 'Agreement between lactate threshold and critical speed in trained, highly trained, and World Class runners',
    authors: ['Katie L. Rainsberger', 'Andrew W. Subudhi', 'James Pearson', 'Marissa N. Baranauskas'],
    publicationYear: 2026,
    doi: '10.1016/j.jsams.2026.04.020',
    urls: ['https://pubmed.ncbi.nlm.nih.gov/42120287/', 'https://doi.org/10.1016/j.jsams.2026.04.020'],
    studyType: 'Cross-sectional paired method-agreement study',
    population: '31名训练至世界级跑者，52%女性；4分钟级乳酸跑台试验，对比3200/2000/1000米最大努力距离–时间线性拟合CS。',
    sampleSize: 31,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_ABSTRACT_ONLY', note: '仅核验PubMed公开摘要；出版方全文未获得，不声称全文核验。online 2026-04-30。' },
    supports: ['CS整体快于modified Dmax及onset-of-blood-lactate估计；个体一致性界限较宽。', '运动水平没有消除两种测试的差异，不能直接互换。'],
    limitations: ['仅一项31人方法比较，且本轮只核验摘要。', '平均偏差不是个人校正值，不建立CS换算LT2的固定比例。'],
    codingConstraints: ['保留既有CS OLS，CS只进入CS字段，不覆写LT2。', '不以CS乘固定比例产生实测LT1/LT2。', '标明CS是特定最大努力及拟合协议的模型估计。'],
  },
  {
    id: 'VDOT-DANIELS-1979',
    status: 'EVIDENCE_INFORMED',
    title: 'Oxygen Power: Performance Tables for Distance Runners',
    authors: ['Jack Daniels', 'Jimmy Gilbert'],
    publicationYear: 1979,
    doi: null,
    urls: ['https://search.worldcat.org/title/30094144', 'https://www.vivamarathon.com/OxygenPower.htm', 'https://www.vivamarathon.com/OxygenPower-filer/image002.jpg', 'https://www.vivamarathon.com/OxygenPower-filer/image004.jpg', 'https://news.vdoto2.com/2023/04/pace-calculator/'],
    studyType: 'Published performance-table method; reproduced original appendix plus official usage guidance',
    population: 'Daniels–Gilbert距离跑表现参考方法；原著附录转载及V.O2 2023官方使用说明未提供可验证软件效度的独立样本量。',
    sampleSize: null,
    verification: { checkedOn: '2026-10-23', scope: 'REPRODUCED_ORIGINAL_APPENDIX_AND_OFFICIAL_GUIDANCE', note: '书目可追溯；公式系数在原著附录转载Fig.1/2图中核对。转载站不是官方算法/API；V.O2官方页面仅用于解释使用边界。' },
    supports: ['v以m/min、t以min代入氧耗二次回归式及可持续百分比式，得到表现参考指数。', 'V.O2官方将跨距离输出称等效表现而非预测，并建议以至少10–12分钟比赛导训练配速。'],
    limitations: ['VDOT不等于实验室实测VO2max、LT2或个人成绩保证。', '附录转载不是独立公式验证；本软件未获官方认证。', '公式可算出数值不代表对400/800、间歇、越野或超马均有效。'],
    codingConstraints: ['本产品仅对持续至少10分钟的真实最大努力比赛给VDOT参考指数；10分钟是保守产品边界。', '不自动生成或覆写T配速、LT/VT阈值，不把间歇当连续比赛输入。', '400/800/1500专项层展示实测成绩、速度保持和目标差，不给VDOT精确比赛预测。'],
  },
  {
    id: 'CONCURRENT-SCHUMANN-2022',
    status: 'EVIDENCE_INFORMED',
    title: 'Compatibility of Concurrent Aerobic and Strength Training for Skeletal Muscle Size and Function: An Updated Systematic Review and Meta-Analysis',
    authors: ['Moritz Schumann', 'Joshua F. Feuerbacher', 'Marvin Sünkeler', 'Nils Freitag', 'Bent R. Rønnestad', 'Kenji Doma', 'Tommy R. Lundberg'],
    publicationYear: 2022,
    firstOnlineYear: 2021,
    doi: '10.1007/s40279-021-01587-7',
    urls: ['https://pmc.ncbi.nlm.nih.gov/articles/PMC8891239/', 'https://doi.org/10.1007/s40279-021-01587-7'],
    studyType: 'Systematic review and meta-analysis',
    population: '43项研究、1090名健康成人；并行耐力与力量590人，对照力量500人；非全部专项跑者。',
    sampleSize: 1090,
    verification: { checkedOn: '2026-10-23', scope: 'PUBLIC_FULL_TEXT', note: '核验PMC全文的43项研究、总人数、爆发力及时间安排亚组和顺序效应限制。' },
    supports: ['最大力量及肌肥大总体未见明显干扰；爆发力适应可能受影响。', '同课安排的爆发力干扰较明显，间隔至少3小时的亚组未见显著效应。'],
    limitations: ['3小时是研究分组条件，不是保证恢复或零干扰的安全线。', '未建立所有跑步专项的统一先后顺序或固定24/48小时禁配规则。', '证据质量与协议有异质性，不能保证个人反应。'],
    codingConstraints: ['同日力量与关键速度/专项/VO2课给目的、先后和间隔复核提示。', '采用软冲突提示，不以固定小时数承诺恢复。', '力量记录独立保留，不强行折算成耐力HR分区或跑量。'],
  },
] as const satisfies readonly TrainingModelEvidence[]

export type TrainingModelEvidenceId = (typeof TRAINING_MODEL_EVIDENCE)[number]['id']

export function getTrainingModelEvidence(id: string): TrainingModelEvidence | undefined {
  return TRAINING_MODEL_EVIDENCE.find(item => item.id === id)
}
