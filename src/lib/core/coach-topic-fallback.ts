import { detectRedFlags, redFlagResponse } from './coach-red-flags.ts'
export const FALLBACK_TOPICS = {
 INJECTION:{match:/忽略.{0,8}(?:规则|指令|限制)|批量.{0,8}(?:课表|计划)|宣布.{0,8}(?:痊愈|恢复)|直接.{0,5}(?:痊愈|放行)|绕过.{0,5}(?:审查|守卫)/,boundary:'不能忽略安全规则、宣布医疗放行或未经确认批量改课表；聊天不足以确认痊愈。可以核对记录并提出由你确认的单项候选。',question:'你希望先核对哪次训练或哪一项调整？'},
 PAIN:{match:/痛|疼|肿|跛|跟腱|胫骨|足跟/,boundary:'先停止诱发不适的动作；酸痛不等于疼痛，也不能据此确认已经恢复，必要时寻求运动医学或康复评估。',question:'不适的部位、性质和日常活动反应是什么？'},
 ILLNESS:{match:/病后|发热|烧|感冒|咳嗽|咽痛|转阴/,boundary:'仍发热或全身不适时暂停运动；病后不补课追进度，先核对功能和症状。',question:'目前还有哪些症状，日常活动是否受影响？'},
 HEAT:{match:/热|暴晒|℃|度|日晒/,boundary:'先减少热暴露、选择凉爽环境；手机气温不能直接当作WBGT，也不据此批准原强度。',question:'当前环境和身体反应怎样，能否改到更凉爽的时段？'},
 ENERGY:{match:/吃|摄入|营养|月经|闭经|节食|体重|能量|red.?s/i,boundary:'先不继续限制摄入或增加训练；持续进食、月经或骨伤变化需运动医学和营养评估。',question:'进食或身体变化持续多久，是否已影响日常活动？'},
 YOUTH:{match:/岁|小学|初中|高中|未成年|孩子|女儿|儿子/,boundary:'请监护人与合格教练参与，先学习规范动作；不远程安排极限测试或套用成人进阶。',question:'目前的训练经验和现场监督条件是什么？'},
 STRENGTH:{match:/力量|深蹲|卧推|硬拉|kg|公斤|rir|负重|重量/i,boundary:'实际重量、次数与动作质量需一起核对；RIR不能由整课RPE推算，维持决定也不等于批准照常练。',question:'同一动作的实际完成、动作质量和剩余次数怎样？'},
 GPS:{match:/gps|距离|跑道|道次|圈|测距/i,boundary:'不自动把手表距离改成标称距离；需确认场地、道次与圈数，再由你正式更正记录。',question:'实际按圈数完成，还是按手表到点停止？'},
 HEART:{match:/心率|胸带|手表|光电|hrv|rhr/i,boundary:'心率只能描述匹配分段的实际记录；方法和时间窗不同不能证明效率变化。',question:'数值来自哪种设备与统计时间窗？'},
 LOAD:{match:/负荷|rpe|au|跑量|加量|分钟|时长/i,boundary:'整课RPE与整课实际分钟配对计算AU；单组评分不代替整课，负荷比较须同口径。',question:'整课评分及包含热身、恢复和整理的总时长是多少？'},
 SLEEP:{match:/睡|熬夜|夜醒|早醒|恢复|疲劳|腿沉/,boundary:'把睡眠与平时水平、白天精神和热身反应一起看；记录缺失不能视为恢复正常。',question:'最近睡眠和日常精神相对平时有什么变化？'},
 GENERAL:{match:/.*/,boundary:'可先基于已核对记录讨论训练原则；缺少信息时暂缓调整，不编个人剂量或更改计划。',question:'你希望先复盘哪节课，或解决哪个训练决定？'}
} as const
export function topicFallback(question:string,facts:string[]=[]):{topic:keyof typeof FALLBACK_TOPICS;text:string}{
 const red=detectRedFlags(question)
 if(red.level==='EMERGENCY'||red.level==='URGENT_MEDICAL')return {topic:'GENERAL',text:redFlagResponse(red)!}
 const topic=(Object.keys(FALLBACK_TOPICS) as (keyof typeof FALLBACK_TOPICS)[]).find(t=>FALLBACK_TOPICS[t].match.test(question))!
 const template=FALLBACK_TOPICS[topic]
 return {topic,text:[...facts.slice(0,3),template.boundary,template.question].join('\n')}
}
