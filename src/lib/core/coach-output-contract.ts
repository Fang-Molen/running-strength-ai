import {z} from 'zod'
/** Provider-independent local validation. Schema success never certifies medical or factual accuracy. */
export const CoachCompletionSchema=z.object({
 mode:z.enum(['answer','ask','unavailable']).optional(),text:z.string().max(24000).optional(),nextStep:z.string().max(6000).nullable().optional(),citations:z.array(z.string().max(240)).max(100).optional(),
 medicalReferral:z.boolean().optional(),sections:z.object({facts:z.array(z.unknown()).max(60).optional(),explanations:z.array(z.unknown()).max(12).optional(),uncertainty:z.array(z.unknown()).max(30).optional(),suggestion:z.unknown().optional()}).passthrough().optional(),
}).passthrough().refine(v=>typeof v.text==='string'||!!v.sections,'text or sections required')
export function validateCoachCompletion(raw:string){
 try{return CoachCompletionSchema.safeParse(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]??raw))}catch{return CoachCompletionSchema.safeParse(null)}
}
/** Remove explicit identifiers without changing training dates, source IDs or measured quantities. */
export function redactCoachIdentifiers(text:string):string{
 return text.replace(/((?:姓名|真实姓名|运动员姓名|联系人)\s*[:：是]\s*)[^\s，。；;"\\]{1,24}/g,'$1[已隐去]')
 .replace(/((?:出生日期|生日|出生于)\s*[:：是]?\s*)\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?/g,'$1[已隐去]')
 .replace(/((?:家庭住址|详细地址|精确位置|GPS坐标|经纬度)\s*[:：是]\s*)[^。；;"\\]{1,100}/gi,'$1[已隐去]')
 .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[手机号已隐去]')
}
