import { MUS } from './muscles';
import { MUSCLE_FN } from './muscle-info';
import { MUSCLES } from '../strength/demo/musclemap.js';

type DisplayPick = { k: string; zh: string; g: string | null; name?: string; side?: string | null; fn?: string | null; rel?: string; pending?: boolean };

export const UNNAMED = '未命名结构（待核）';
export const muscleName = (key: string) => (MUSCLES as Record<string, string>)[key] ?? MUS.find(m => m.k === key)?.zh ?? key;

/** Display only. The iliotibial wording restores the user's supplied screenshot.
 *  v89.10.3: prefers the per-mesh Chinese function/related text from v89.10.2 (anatomy-zh), never shows a raw English mesh name. */
export function muscleDisplay(pick: DisplayPick) {
  const identifiers = `${pick.k} ${pick.name ?? ''} ${pick.zh}`;
  const side = pick.side === 'left' || /\bleft[ _-]/i.test(identifiers) ? '左侧'
    : pick.side === 'right' || /\bright[ _-]/i.test(identifiers) ? '右侧' : '';
  if (/iliotibial[ _-]*(tract|band)|髂胫束/i.test(identifiers)) {
    return {
      name: `${side}髂胫束（筋膜结构，非肌肉）`,
      effect: '传递阔筋膜张肌和臀大肌的张力，稳定膝外侧；属于被动结构，不主动收缩。',
      related: ['阔筋膜张肌', '臀大肌'],
    };
  }
  const zh = pick.zh && !/[A-Za-z]{3}/.test(pick.zh) ? pick.zh : UNNAMED;
  const fn = pick.fn ?? MUSCLE_FN[pick.k] ?? null;
  const rel = pick.rel ? pick.rel.split(/[、,，]/).map(s => s.trim()).filter(Boolean) : null;
  return {
    name: zh === UNNAMED || /^[左右]/.test(zh) ? zh : `${side}${zh}`,
    effect: fn ? `${fn}${pick.pending ? '（待核）' : ''}` : null,
    related: rel ?? (pick.g ? MUS.filter(m => m.g === pick.g && m.k !== pick.k).map(m => m.zh) : []),
  };
}
