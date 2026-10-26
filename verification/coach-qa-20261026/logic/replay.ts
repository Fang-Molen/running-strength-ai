// Synthetic messages and fixture records only; no network, model calls, or user data.
import { answerLocally, answerStaysLocal } from '../../../src/lib/core/coach-local-first'
import { assembleCoachBrief } from '../../../src/lib/core/coach-brief'
import { setStoreBackend } from '../../../src/lib/core/storage'
import { firstWeekMemory } from '../../../src/lib/core/coach-first-week.fixtures'
import { detectRedFlags } from '../../../src/lib/core/coach-red-flags'
import { guardR5Reply } from '../../../src/lib/coach/r5/guard'
import { context, metric } from '../../../src/lib/health/analysis-fixtures'
import { projectAnalysisEvidence } from '../../../src/lib/health/analysis-evidence'
import { buildMuscleExposure } from '../../../src/lib/health/muscle-exposure'
import { evaluateRecoveryEvidence } from '../../../src/lib/health/recovery-assessment'
import { buildCoachAnalysisPacket } from '../../../src/lib/health/analysis-packet'
const snapshot=projectAnalysisEvidence({context,facts:[metric({metric:'SLEEP',value:6,unit:'h'}),metric({id:'hrv',metric:'HRV',value:40,unit:'ms'})]})
const exposure=buildMuscleExposure(snapshot)
const packet=buildCoachAnalysisPacket(snapshot,evaluateRecoveryEvidence(snapshot,exposure),exposure)
const hold={...packet,assessment:{...packet.assessment,safetyState:'HOLD_ACTIVE' as const}}
const answers=[]
setStoreBackend(firstWeekMemory())
try {
 for(const question of ['什么是轻松跑？','请给我解释轻松跑是什么。','昨天间歇跑为什么掉速？','我昨天跑完腿疼，间歇跑怎么安排？','膝盖越来越疼，但HRV正常，为什么不能照常间歇跑？','为什么力量训练能帮助跑步？']){
  const answer=answerLocally(assembleCoachBrief(null,question,null))
  answers.push({question,safety:detectRedFlags(question),localOnly:answer.localOnly??null,staysLocal:answerStaysLocal(answer),text:answer.text,sources:answer.sources,candidate:answer.candidate??null})
 }
}finally{setStoreBackend(null)}
const guards=['你目前不能解除疼痛限制。','HRV正常不代表可以继续跑步。','不能解除疼痛限制，但可以继续跑步。','1、先核对当前症状。\n2）再核对实际记录。','不能不解除疼痛限制。','记录中的HRV为40 ms。','1. 跑5公里。'].map(text=>({text,result:guardR5Reply(text,hold)}))
console.log(JSON.stringify({synthetic:true,answers,guards},null,2))
