/** Presentation-only paraphrases. Original source text/review status is unchanged. */
import readings from './knowledge-reader.json' with { type: 'json' }
import type { SportDocument } from './knowledge-catalog.ts'
const index = new Map(readings.map(r => [r.id, r]))
export function athleteReading(doc: SportDocument) {
  return index.get(doc.id) ?? {id:doc.id,title:doc.title,summary:doc.summary,points:[doc.body],practice:doc.practice,note:doc.limits}
}
export function readerSearchText(doc: SportDocument) {
  const r = index.get(doc.id)
  return r ? [r.title,r.summary,...r.points,r.practice,r.note].join(' ') : ''
}
