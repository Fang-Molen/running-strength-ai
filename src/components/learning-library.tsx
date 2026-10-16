import { useState } from 'react';
import { MuscleExplorerSheet } from '@/components/muscle-explorer';
import { BookOpen, ArrowUpRight } from 'lucide-react';
import { TEACHING_RULES, TEACHING_SOURCES } from '@/lib/core/coach-curriculum-data';
import { CATALOG } from '@/lib/strength/catalog';

const CATEGORIES = [
  { id: 'technique', label: '动作技术', hint: '动作说明与手动编辑', cores: [] },
  { id: 'course', label: '专项与课程', hint: '目标、训练与周期', cores: ['P', 'C'] },
  { id: 'recovery', label: '恢复与重建', hint: '观察恢复与限制', cores: ['R'] },
  { id: 'nutrition', label: '饮食与营养', hint: '食物库与摄入记录', cores: [] },
  { id: 'record', label: '记录与设备', hint: '数据来源与使用范围', cores: ['A'] },
  { id: 'review', label: '阶段复盘', hint: '反馈、解释与调整', cores: ['D'] },
] as const;

/** Existing teaching materials only. Browsing never submits a question or changes athlete data. */
export function LearningLibrary({ onNavigate, publicReferencesAllowed = false }: { onNavigate?: (tab: 'plan' | 'body' | 'log') => void; publicReferencesAllowed?: boolean }) {
  const [category, setCategory] = useState<string>('course');
  const [mx, setMx] = useState(false);
  const selected = CATEGORIES.find(item => item.id === category)!;
  const lessons = TEACHING_RULES.filter(rule => (selected.cores as readonly string[]).includes(rule.originalId[0]));
  return <section className="learning-library" aria-label="方坤学习目录">
    <div className="product-section-heading"><div><p className="product-eyebrow">按需要学习</p><h2>训练之外，也能理解训练</h2></div><BookOpen size={21} aria-hidden="true" /></div>
    <p className="mt-2 text-sm text-muted">沿用已接入的教学资料。学习内容与个人训练建议分别呈现。</p>
    <div className="learning-categories" role="group" aria-label="内容栏目">
      {CATEGORIES.map(item => <button key={item.id} type="button" aria-pressed={item.id === category} onClick={() => setCategory(item.id)}><strong>{item.label}</strong><span>{item.hint}</span></button>)}
    </div>
    {category === 'technique' ? <div className="home-card p-4"><h3 className="font-bold">现有动作库 · {CATALOG.length} 个动作</h3><p className="mt-2 text-sm text-muted">在计划里选择动作，可查看原有动作示意、技术提示与设置；浏览不会加入课表。</p><button type="button" className="product-text-action" onClick={() => onNavigate?.('plan')}>打开动作与课表 <ArrowUpRight size={16} /></button><button type="button" className="product-text-action" onClick={() => setMx(true)}>人体肌群 3D · 足踝小腿动作 <ArrowUpRight size={16} /></button>{mx ? <MuscleExplorerSheet onClose={() => setMx(false)} /> : null}</div> : null}
    {category === 'nutrition' ? <div className="home-card p-4"><h3 className="font-bold">食物、餐食与营养记录</h3><p className="mt-2 text-sm text-muted">原有食物搜索、手动记录和营养明细保留在身体页。这里只提供入口，尚未接入独立营养教学正文。</p><button type="button" className="product-text-action" onClick={() => onNavigate?.('body')}>打开饮食与营养 <ArrowUpRight size={16} /></button></div> : null}
    <div className="space-y-3 mt-3">
      {lessons.map(rule => <details key={rule.id} className="home-card p-4">
        <summary className="min-h-11 cursor-pointer"><span className="product-eyebrow">{rule.core}</span><strong className="block mt-1 text-sm">{rule.title}</strong></summary>
        <p className="mt-3 text-sm leading-relaxed">{rule.guidance}</p>
        <p className="mt-2 text-xs text-muted">适用边界：{rule.counterexample}</p>
        <details className="mt-3 text-xs"><summary className="min-h-11 cursor-pointer font-bold">来源与核验范围</summary>
          <p className="text-muted">教学候选资料；本轮没有升级文献核验等级，也不作为个人处方。</p>
          {!publicReferencesAllowed ? <p className="mt-2 text-muted">本地可读来源说明。需要打开外部资料时，请先在对话页开启公开知识权限；离线时不打开外部链接。</p> : null}
          {TEACHING_SOURCES.filter(source => rule.evidenceRefs.includes(source.id)).map(source => <div className="mt-3" key={source.id}>{publicReferencesAllowed ? <a className="font-bold underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <p className="font-bold">{source.title}</p>}<p className="mt-1 text-muted">{source.reportedCheckDescription}</p><p className="mt-1 text-muted">{source.limitations}</p></div>)}
        </details>
      </details>)}
    </div>
  </section>;
}
