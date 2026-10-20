import { detectRedFlags } from '../../src/lib/core/coach-red-flags.ts'
import { assembleCoachBrief } from '../../src/lib/core/coach-brief.ts'
for (const q of ['疼痛0、无胸痛晕厥发热。请计算变化','当前没有晕厥胸痛或急性骨痛，监护人可以联系','现在普通走路疼痛0/10，无明显畸形','睡7小时，疼痛0。原教练','前夜睡7.5小时、疼痛0。请分别','无痛无急症','胸口压迫感、冷汗，现在仍在']) { const r = detectRedFlags(q); const b = assembleCoachBrief(null, q, null); console.log(q, '=>', r.level, r.classes.join(','), r.evidence.join('|'), 'pain=', b.pain, b.constraints.medicalReferral) }
