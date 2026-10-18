/** General explanations and reversible adjustments for ordinary discomfort; never diagnoses or clearance. */
export function ordinaryDiscomfortAnswer(question: string): string | null {
  if (!/我|刚|今天|现在|训练后|跑步时|练完|跑完|岔气|酸痛|抽筋/.test(question) || /假如|假设|科普|如果|朋友|同伴/.test(question)) return null
  // Denial of chest pain must not suppress an independently asserted ordinary symptom.
  question=question.replace(/(?:没有|并无|无)(?:明显)?(?:酸痛|抽筋|岔气|疲劳|头晕)/g,'')
  const escalation = '如果出现胸痛、晕倒、明显呼吸困难或单侧无力等异常，立即停止活动并呼叫急救；普通不适持续、反复或加重时也应就医评估。'
  if (/头晕/.test(question) && /缓解|好了|恢复正常|不晕了/.test(question)) return '已经缓解的轻度头晕可能与骤停、炎热、饮水或进食不足等有关，单凭描述不能确定原因。先休息、缓慢改变体位，核对饮水和进食；今天不急着补回强度，观察是否反复。' + escalation
  if (/酸痛/.test(question)) return '训练后肌肉酸痛可能与不熟悉的动作或近期负荷变化有关，酸痛程度不等于训练效果。先减轻诱发不适的负荷，做舒适范围内的日常活动，不强行拉伸或硬顶原计划；若是骨面定点痛、明显肿胀或影响走路，应停止相关动作并就医。' + escalation
  if (/抽筋/.test(question)) return '抽筋可能与局部疲劳、训练负荷和环境等因素有关，不能只归因于缺盐。先停下诱发抽筋的动作、放松肌肉，缓解后再评估活动，不立刻追回训练量；反复或长时间不缓解需要就医。' + escalation
  if (/岔气/.test(question)) return '跑步中的岔气可能与呼吸节奏、进食时机和躯干负荷有关。先减慢或暂停，调整为舒适呼吸，缓解后再决定是否继续轻活动；持续腹痛或反复加重需要就医排查。' + escalation
  if (/(?:有点|轻微|普通|只是|训练后|跑完).{0,4}(?:疲劳|累)/.test(question)) return '一次训练后的疲劳可能来自运动负荷、睡眠或进食等多种因素，不等于已经过度训练。先减少额外负担、安排休息并核对睡眠和补给，再观察日常活动是否恢复；持续疲劳或反复影响生活时请就医评估。' + escalation
  return null
}
