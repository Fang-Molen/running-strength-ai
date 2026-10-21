/** Athlete-facing labels and read-only answers for a specific library item. */
import { SPORT_DOCUMENTS, findSportSource, type SportDocument } from './knowledge-catalog.ts';

import { athleteReading } from './knowledge-reader.ts';

export { sportSourceReadLabel } from './knowledge-catalog.ts';

export function sportDocumentLabel(doc: SportDocument): string {
  return doc.kind === 'research-note' ? '研究笔记 · 待专业审核'
    : doc.kind === 'literature' ? '文献索引' : '基础课程';
}

export function learningQuestion(doc: SportDocument): string {
  return `“${athleteReading(doc).title}”能用简单的话讲讲吗？`;
}

/** Only the exact library question takes this route. Edited/personal questions
 * continue through the normal coach safety and evidence pipeline. Never infer
 * personal training facts from an article's example numbers. */
export function answerLearningQuestion(question: string): string | null {
  const doc = SPORT_DOCUMENTS.find(item => learningQuestion(item) === question.trim());
  if (!doc) return null;
  const reading = athleteReading(doc);
  const sources = doc.sourceIds.map(findSportSource).filter(source => source !== undefined);
  return [
    reading.title,
    doc.kind === 'research-note' ? '这条研究草稿仍待专业审核，仅供查阅。' : reading.summary,
    reading.points.map(p=>`• ${p}`).join('\n'),
    `平时怎么用：${reading.practice}`,
    reading.note,
    '这是一般知识。要讨论你今天怎么练，还需要近期训练和身体反馈；不会因此自动修改课表。',
    `参考：${sources.map(source=>source.title).join('；')}。详细说明和适用范围可返回原文查看。`,
  ].join('\n\n');
}
