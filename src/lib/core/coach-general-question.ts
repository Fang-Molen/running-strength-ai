import { explainTrainingMechanism } from './coach-training-mechanisms'
import { OFFLINE_COACH_RULES } from './coach-offline'
import { retrieveCurriculum } from './coach-curriculum'
/** General teaching does not require athlete measurements or authorize a prescription. */
export function generalKnowledgeAnswer(question: string): {text:string;sources:string[]} | null {
 // Remove only a leading teaching request; personal facts later in the message
 // must still be screened (including requests that omit the pronoun “我”).
 const q=question.trim().replace(/^(?:请)?(?:给我|帮我)(?:解释|介绍|讲解)(?:一下)?|^我(?:想了解|想知道|想问)(?:一下)?/, '')
 if(!/什么是|是什么|什么意思|原理|为什么|为何|区别|有什么(?:用|作用)|解释|介绍|科普/.test(q))return null
 // Personal facts, requests to write, current symptoms and dated prescriptions stay in the existing analysis chain.
 if(/我|本人|咱|自己|朋友|队友|学员|最近|现在|今天|昨天|昨晚|明天|上周|这周|本周|下周|这次|本次|上次|下次|下个月|根据.{0,12}(?:记录|训练|数据)|适合|安排|制定|修改|改成|保存|记录下来|反而|这么|(?:跑|练|睡|吃|完成|提高|增长)了|胸痛|晕厥|呼吸困难|受伤|疼|痛|不舒服|跑不动|练不动/.test(q))return null
 const curriculum=retrieveCurriculum(q,2)
 const rule=OFFLINE_COACH_RULES.find(r=>r.match.test(q))
 const sources=[...new Set([...(rule?.sourceIds??[]),...curriculum.lessons.map(r=>r.id)])]
 const mechanism=explainTrainingMechanism(q)
 if(mechanism)return {text:`${mechanism.observation}\n\n${mechanism.plausibleMechanism}\n\n这是一般原理；用于你的训练时，还需结合目标、实际训练和恢复反应。`.slice(0,1000),sources}
 if(!rule&&!curriculum.lessons.length)return null
 const lines=curriculum.lessons.map(r=>`${r.title}：${r.guidance}`)
 const definition=rule?.topic==='EASY'?'轻松跑是以轻松活动为目的的低强度跑步；用交谈是否轻松和主观感受来核对强度，不要求所有人采用同一配速。':null
 return {text:[definition,rule?.conclusion,rule?.template,...lines,'以上是一般训练知识，不代表已经评估你的个人能力，也没有修改计划。'].filter(Boolean).join('\n\n').slice(0,1000),sources}
}
