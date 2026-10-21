/** Athlete-facing labels and read-only answers for a specific library item. */
import { SPORT_DOCUMENTS, findSportSource, sportSourceReadLabel, type SportDocument } from './knowledge-catalog.ts';

export { sportSourceReadLabel } from './knowledge-catalog.ts';

export function sportDocumentLabel(doc: SportDocument): string {
  return doc.kind === 'research-note' ? '研究笔记 · 待专业审核'
    : doc.kind === 'literature' ? '文献索引' : '基础课程';
}

export function learningQuestion(doc: SportDocument): string {
  return `请解释运动知识“${doc.title}”（资料编号${doc.id}）的适用范围和限制。`;
}

/** Only the exact library question takes this route. Edited/personal questions
 * continue through the normal coach safety and evidence pipeline. Never infer
 * personal training facts from an article's example numbers. */
export function answerLearningQuestion(question: string): string | null {
  const doc = SPORT_DOCUMENTS.find(item => learningQuestion(item) === question.trim());
  if (!doc) return null;
  const sources = doc.sourceIds.map(findSportSource).filter(source => source !== undefined);
  return [
    '【知识讲解 · 本地资料】',
    doc.title,
    doc.kind === 'research-note' ? '这条研究笔记仍待专业审核，仅供查阅。' : doc.summary,
    doc.body,
    `${doc.kind === 'literature' ? '查阅建议' : '怎样理解或观察'}：${doc.practice}`,
    `适用限制：${doc.limits}`,
    '这是一般知识讲解，不能据此判断你已恢复、批准加量或修改课表。若要讨论个人适用性，请另行说明你的目标、实际训练和身体反馈。',
    '参考来源：',
    ...sources.map(source => `${source.title}（${source.year}；${sportSourceReadLabel(source.readLevel)}）。来源限制：${source.limits}`),
    '可返回「学习」查看原文链接；你的搜索和展开内容会保留。',
  ].join('\n\n');
}
