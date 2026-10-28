/** Product description rules, not validated physiological or diagnostic thresholds. */
export const METRIC_TRAJECTORY_RULE = {
  id:'FK_RECOVERY_HISTORY_SEGMENTS_1',version:'2026-10-28.1',
  source:'PRODUCT_DESCRIPTIVE_POLICY',calibration:'NOT_VALIDATED',
  evidenceStatus:'ENGINEERING_SYNTHETIC_ONLY',prescriptionAllowed:false,
  method:'按已保存且截至分析时可知的独立历史日排序；排除当前日；等分较早/较后两段并比较中位数。至少每段两个独立日仅为分段描述最低结构要求，不是医学充分性阈值。',
  reviewTrigger:'较后段所有值同处较早段中位数的一侧时提示描述性方向变化；无生理幅度阈值，不诊断持续恶化。',
  scope:'同运动员、来源、账号、设备、协议、单位、统计口径与时区；算法未单独记录时明确未知。',
  limitations:'较早段来自本次可读取历史，不是冻结或经验证的健康基线；缺失、阶段变化、生活与环境因素仍需解释。',
  ledgerRef:'docs/implementation-20261028/rule-ledger.md#FK_RECOVERY_HISTORY_SEGMENTS_1',
} as const;
