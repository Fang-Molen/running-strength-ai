import { assessCoachQuestion, type CoachQuestionAssessment } from './coach-question-reasoning.ts'

/** Stateless persistence contract: caller stores and supplies the returned state. */
export type AthleteDialogueState = {
  version: 1
  athleteType: 'MIDDLE_LONG_DISTANCE' | 'UNKNOWN'
  personalBests: { eventMeters: number; seconds: number; age: 'CURRENT_UNCONFIRMED' | 'HISTORICAL' }[]
  recentTrainingStatus: 'INTERRUPTED' | 'UNKNOWN'
  lastQuestion: string | null
  observations: string[]
}
export type AthleteDialogueResult = {
  state: AthleteDialogueState
  assessment: CoachQuestionAssessment
  historical3000EquivalentSeconds: number | null
  predictionStatus: 'HISTORICAL_EQUIVALENT_ONLY' | 'INSUFFICIENT_CURRENT_EVIDENCE'
  safeguards: string[]
}
export const emptyAthleteDialogueState = (): AthleteDialogueState => ({version:1,athleteType:'UNKNOWN',personalBests:[],recentTrainingStatus:'UNKNOWN',lastQuestion:null,observations:[]})

/** Accepts a single utterance and a prior state; no external model or network. */
export function advanceAthleteDialogue(previous: AthleteDialogueState, utterance: string): AthleteDialogueResult {
  const state: AthleteDialogueState = JSON.parse(JSON.stringify(previous))
  const q=utterance.trim()
  if (/中长跑|中长距离|长跑选手/.test(q)) state.athleteType='MIDDLE_LONG_DISTANCE'
  if (/停训(?:了)?(?:半|[一二三四五六七八九十\d]+)\s*(?:个)?月|停训半年/.test(q)) state.recentTrainingStatus='INTERRUPTED'
  // Only extract explicitly marked PB, not targets, intervals or hypothetical examples.
  const pb = q.match(/(?:5000\s*(?:米|m)|五千米)\s*(?:PB|pb|个人最好|最好成绩)?\s*(?:是|为|跑了|达到|:|：)?\s*(\d{1,2})\s*(?:分|:|：)\s*(\d{1,2})(?:\s*秒)?\s*(?:的)?\s*(?:PB|pb)?/)
  if (pb && /PB|pb|个人最好|最好成绩/.test(q)) {
    const seconds=Number(pb[1])*60+Number(pb[2]);
    if(seconds>=600 && seconds<=3600){
      const age: 'HISTORICAL'|'CURRENT_UNCONFIRMED' = /(?:去年|前年|两年前|三年前|以前|历史)/.test(q)?'HISTORICAL':'CURRENT_UNCONFIRMED'
      state.personalBests=state.personalBests.filter(p=>p.eventMeters!==5000).concat({eventMeters:5000,seconds,age})
      state.observations.push(`用户明确报告5000米PB ${pb[1]}:${pb[2].padStart(2,'0')}；未独立核验`)
    }
  }
  // Do not silently replace a historical PB with a hypothetical or goal.
  // Dialogue state is an explicit caller-owned snapshot, never localStorage.
  const assessment=assessCoachQuestion(q)
  const has5000=state.personalBests.find(p=>p.eventMeters===5000)
  const equivalent=has5000?Math.round(has5000.seconds*Math.pow(3000/5000,1.06)):null
  const safeguards=['历史成绩换算不等于当前成绩预测','缺少近期正式测试、训练负荷和恢复证据，不输出当前成绩区间','不授权自动修改计划']
  if(assessment.safety==='EMERGENCY') safeguards.unshift('安全优先：不执行训练建议或成绩预测')
  state.lastQuestion=q
  return {state,assessment,historical3000EquivalentSeconds:assessment.safety==='EMERGENCY'?null:equivalent,predictionStatus:assessment.safety==='EMERGENCY'?'INSUFFICIENT_CURRENT_EVIDENCE':equivalent!==null?'HISTORICAL_EQUIVALENT_ONLY':'INSUFFICIENT_CURRENT_EVIDENCE',safeguards}
}
