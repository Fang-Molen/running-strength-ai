/** P0 output invariant: a model's ask/refusal route must not erase a source-backed referral. */
export type ReferralTurn<T extends string = string> = {mode:T;text:string;medicalReferral:boolean;nextStep:string|null}
export function preserveReferral<T extends ReferralTurn>(turn:T, medicalReferral:boolean):T {
 if(!medicalReferral)return turn
 const referral='已有疼痛或相关风险记录，必要时请寻求运动医学或康复专业评估；这不是诊断。'
 // Mentioning a referral in a negated instruction is NOT equivalent to
 // actually preserving the safety recommendation.
 const negated=/(?:不必|不用|不需要|无需|别|不要).{0,12}(?:运动医学|康复|医生|医疗|评估|就医|急诊)/.test(turn.text)
 if(!negated&&/(?:运动医学|康复|医生|医疗).{0,12}评估|就医/.test(turn.text))return {...turn,medicalReferral:true}
 const max=900
 return {...turn,medicalReferral:true,text:turn.text.slice(0,max-referral.length)+referral}
}
