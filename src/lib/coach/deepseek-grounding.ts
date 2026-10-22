import type { AskCoachData } from '../strength/coach-pipeline'
import type { CoachBrief } from '../core/coach-brief'

type Quantity = { kind: string; value: number }
/** Limited lexical guard, not an expert semantic or scientific certification. */
function quantities(text: string, strict = false): Quantity[] {
  const values: Quantity[] = []
  const add = (kind: string, value: number) => { if (Number.isFinite(value)) values.push({ kind, value }) }
  // Normalize composite durations before scanning; 1分20秒 is one 80-second value.
  const normalized = text.normalize('NFKC').replace(/(\d+(?:\.\d+)?)\s*分\s*(\d+(?:\.\d+)?)\s*秒/g, (_, minutes, seconds) => `${Number(minutes) * 60 + Number(seconds)}秒`)
  if (strict && /[零〇一二两三四五六七八九十百千万亿点]+\s*(?:秒|分钟|小时|公里|千米|米|公斤|千克|AU|%|轮)|百分之[零〇一二两三四五六七八九十百千万亿点]+|RPE\s*[零〇一二两三四五六七八九十百千万亿点]+/i.test(normalized)) throw new Error('UNSUPPORTED_CHINESE_QUANTITY')
  let remaining = normalized
  const scan = (pattern: RegExp, apply: (match: RegExpExecArray) => void) => {
    remaining = remaining.replace(pattern, (...args) => {
      // The patterns have no named groups. Preserve captures for one common scanner.
      apply(args.slice(0, -2) as unknown as RegExpExecArray)
      return ' '
    })
  }
  scan(/第\s*(\d+)\s*(轮|组|次)/g, match => add('ORDINAL_' + match[2], Number(match[1])))
  scan(/(?:配速\s*)?(\d{1,2})[:'：](\d{2})\s*(?:["″]?\s*\/\s*km|每公里)/gi, match => add('PACE_SECONDS_PER_KM', Number(match[1]) * 60 + Number(match[2])))
  scan(/(?<![\d.])(-?\d+(?:\.\d+)?)\s*(公里|千米|km\b|米|m\b|分钟|min\b|小时|h\b|秒|s\b|公斤|千克|kg\b|组|次|AU\b|%|％)/gi, match => {
    const number = Number(match[1]), unit = match[2].toLowerCase()
    if (['公里', '千米', 'km', '米', 'm'].includes(unit)) add('DISTANCE_M', number * (['公里', '千米', 'km'].includes(unit) ? 1000 : 1))
    else if (['分钟', 'min', '小时', 'h', '秒', 's'].includes(unit)) add('TIME_SECONDS', number * (['分钟', 'min'].includes(unit) ? 60 : ['小时', 'h'].includes(unit) ? 3600 : 1))
    else if (['公斤', '千克', 'kg'].includes(unit)) add('WEIGHT_KG', number)
    else if (['%', '％'].includes(unit)) add('PERCENT', number)
    else add(unit, number)
  })
  scan(/RPE\s*(?:为|是|记为|[:：])?\s*(\d+(?:\.\d+)?)(?:\s*\/\s*10)?/gi, match => add('RPE', Number(match[1])))
  // FACT rating records use these stable prefixes; their values aren't generic seconds.
  scan(/SESSION_RPE\s[^:：]*[:：]\s*(\d+(?:\.\d+)?)(?:\s*\/\s*10)?/g, match => add('RPE', Number(match[1])))
  // Enumerated paragraphs are not measurements. Other naked numerals must not
  // slip through as "用时77", unsupported units, dates or invented scores.
  remaining = remaining.replace(/(?:^|\n)\s*\d+[、.)）]/g, ' ')
  if (strict && /\d/.test(remaining)) throw new Error('UNSUPPORTED_NUMBER_NOTATION')
  return values
}
const same = (a: Quantity, b: Quantity) => a.kind === b.kind && Math.abs(a.value - b.value) <= 1e-8 * Math.max(1, Math.abs(a.value), Math.abs(b.value))

/**
 * The model may explain supplied calculations; it may not invent another number
 * or perform a new, untraceable calculation. Enforce quantities against cited
 * actual/derived source text, before the existing full semantic/safety guards.
 */
export function assertDeepSeekNumericGrounding(data: AskCoachData, raw: string): void {
  const completion = JSON.parse(raw) as { text?: unknown; nextStep?: unknown; citations?: unknown; planChanged?: unknown }
  if (completion.planChanged !== false) throw new Error('PLAN_WRITE_ASSERTION')
  if (typeof completion.text !== 'string' || !Array.isArray(completion.citations)) throw new Error('INVALID_COMPLETION')
  const cited = new Set(completion.citations.filter((id): id is string => typeof id === 'string'))
  const briefs: CoachBrief[] = data.series ? data.series.points.map(p => p.brief) : data.compare ? [data.compare.left, data.compare.right] : [data.brief]
  const valid = briefs.flatMap(brief => (brief.sources ?? []).filter(source => cited.has(source.id) && source.kind !== 'CONTEXT').flatMap(source => quantities(source.detail)))
  const text = [completion.text, typeof completion.nextStep === 'string' ? completion.nextStep : ''].join('\n')
  for (const claim of quantities(text, true)) if (!valid.some(value => same(value, claim))) throw new Error(`UNVERIFIED_MODEL_QUANTITY:${claim.kind}`)
}

/** Stronger server boundary: numeric statements must be verbatim excerpts of a
 * cited actual/derived source. A correct number from another source is insufficient.
 * This does not certify the scientific interpretation of nonnumeric prose. */
export function assertDeepSeekEvidenceQuotes(data:AskCoachData,raw:string):void{
 const c=JSON.parse(raw) as {text:string;nextStep?:string|null;citations:string[];evidenceQuotes?:{sourceId:string;quote:string}[]}
 const briefs=data.series?data.series.points.map(p=>p.brief):data.compare?[data.compare.left,data.compare.right]:[data.brief]
 let remaining=[c.text,c.nextStep??''].join('\n')
 const claims=c.evidenceQuotes??[]
 if(!Array.isArray(claims)||claims.length>48)throw Error('INVALID_EVIDENCE_QUOTES')
 for(const claim of claims){
  if(!claim||Object.keys(claim).some(k=>!['sourceId','quote'].includes(k))||typeof claim.quote!=='string'||!claim.quote.trim()||claim.quote.length>1000||!c.citations.includes(claim.sourceId))throw Error('INVALID_EVIDENCE_QUOTE')
  const sources=briefs.flatMap(b=>b.sources??[]).filter(s=>s.id===claim.sourceId&&s.kind!=='CONTEXT')
  if(!sources.length||!sources.every(s=>s.detail.includes(claim.quote))||!remaining.includes(claim.quote))throw Error('SOURCE_QUOTE_MISMATCH')
  remaining=remaining.split(claim.quote).join(' ')
 }
 if(quantities(remaining,true).length)throw Error('UNBOUND_NUMERIC_CLAIM')
}
