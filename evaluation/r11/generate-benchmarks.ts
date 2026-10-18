/** Codex 自行生成，未参考外部封存题。Development benchmark, not unseen validation. */
import {writeFileSync} from 'node:fs'
import {PLAYBOOK_CONCEPTS} from '../../src/lib/core/coach-playbook-concepts.ts'
import {DIAGNOSIS_TERMS} from '../../src/lib/core/coach-diagnosis-wording.ts'
const output='src/lib/core/__fixtures__/'
const templates=[(a:string,b:string)=>`遇到${a}时，我想弄清${b}该怎样核对。`,(a:string,b:string)=>`朋友提到${a}；如果涉及${b}，先了解什么？`,(a:string,b:string)=>`能从${a}和${b}这两方面解释训练原则吗？`,(a:string,b:string)=>`关于${a}，除了${b}还需要了解哪些信息？`]
const rows=Object.entries(PLAYBOOK_CONCEPTS).flatMap(([id,groups])=>Array.from({length:20},(_,i)=>({text:templates[i%4](groups[i%3].synonyms[i%10],groups[(i+1)%3].synonyms[(i+3)%10]),expected:id,note:'Codex 自行生成，未参考外部封存题；概念组合基准，不等于盲测'})))
writeFileSync(output+'playbook-retrieval.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n')
const diagnoses=DIAGNOSIS_TERMS.filter((_,i)=>i%2===0).slice(0,40).flatMap((name,i)=>[
 {text:['解释1：你的表现可能是','这符合','你得了','这提示'][i%4]+name+'。记录时长为40分钟。',violation:true},
 {text:`先停止诱发不适的动作。需要医生排除${name}，不能靠聊天确定。`,violation:false},
])
diagnoses.push(...['心肌炎','应力性骨折','热射病','贫血','哮喘','抑郁症'].flatMap(name=>[
 {text:`需要医生排除${name}。`,violation:true},
 {text:`先核对症状。需要医生排除${name}。也需要医生排除脑卒中。`,violation:true},
 {text:`按你提供的医生诊断，既往有${name}；请按面诊建议复查。`,violation:false},
]))
writeFileSync(output+'diagnosis-wording.jsonl',diagnoses.map(r=>JSON.stringify({...r,note:'Codex 自行生成，未参考外部封存题'})).join('\n')+'\n')
