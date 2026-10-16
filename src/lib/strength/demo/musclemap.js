// @ts-nocheck — supplied MIT reference renderer, typed via adjacent declaration.
// 方坤 自制人体肌肉图 (front/back), self-made polygons, MIT. Left half defined, mirrored.
export const MUSCLES = {
  chest: '胸大肌', delt_front: '三角肌前束', delt_side: '三角肌中束', delt_rear: '三角肌后束', biceps: '肱二头肌', triceps: '肱三头肌', forearm: '前臂',
  abs: '腹直肌', obliques: '腹斜肌', hip_flexors: '髂腰肌', traps: '斜方肌', lats: '背阔肌', rhomboids: '菱形肌/中背', erectors: '竖脊肌',
  glutes: '臀大肌', glute_med: '臀中肌', quads: '股四头肌', adductors: '内收肌', hamstrings: '腘绳肌', calves: '腓肠肌', soleus: '比目鱼肌', feet: '足底内在肌'
};
const F = {
  traps: [[47, 30], [44, 34], [37, 38], [47, 37]], chest: [[49, 42], [37, 40], [33, 48], [37, 58], [49, 60]],
  delt_front: [[37, 38], [31, 38], [27, 46], [29, 54], [34, 48]], delt_side: [[31, 37], [25, 40], [24, 50], [27, 46]],
  biceps: [[28, 56], [24, 58], [22, 74], [25, 79], [29, 71]], forearm: [[23, 82], [19, 86], [17, 107], [21, 109], [25, 92]],
  abs: [[49, 62], [42, 62], [41, 100], [49, 104]], obliques: [[41, 62], [36, 60], [35, 92], [41, 98]],
  hip_flexors: [[42, 104], [37, 102], [40, 116], [46, 112]], quads: [[38, 116], [34, 120], [33, 150], [37, 166], [43, 164], [45, 132]],
  adductors: [[46, 116], [49, 121], [48, 150], [45, 152], [44, 130]], calves: [[36, 174], [34, 182], [36, 198], [40, 198], [41, 180]],
  feet: [[35, 201], [32, 207], [34, 211], [42, 211], [42, 201]]
};
const B = {
  traps: [[49, 30], [44, 34], [35, 38], [41, 45], [49, 62]], delt_rear: [[35, 38], [29, 40], [27, 50], [33, 48]], delt_side: [[31, 37], [25, 40], [24, 50], [27, 46]],
  triceps: [[29, 54], [24, 57], [22, 74], [27, 78], [30, 64]], forearm: [[23, 82], [19, 86], [17, 107], [21, 109], [25, 92]],
  rhomboids: [[48, 44], [43, 47], [43, 58], [48, 60]], lats: [[41, 50], [34, 55], [37, 84], [46, 92], [48, 76], [44, 62]],
  erectors: [[49, 70], [45, 72], [45, 100], [49, 102]], glute_med: [[44, 100], [36, 101], [35, 110], [42, 108]],
  glutes: [[49, 106], [38, 108], [35, 121], [40, 129], [49, 127]], hamstrings: [[38, 131], [35, 135], [36, 164], [42, 166], [46, 137]],
  adductors: [[47, 129], [49, 133], [48, 148], [46, 141]], calves: [[36, 170], [34, 180], [36, 186], [42, 186], [42, 176]], soleus: [[36, 186], [37, 197], [41, 197], [42, 186]],
  feet: [[37, 200], [36, 206], [38, 211], [42, 211], [42, 200]]
};
const FEET = 'M34 199l-3 8 2 5h10v-13ZM66 199l3 8-2 5H57v-13Z';
const SIL = 'M50 5a11 11 0 1 1-.01 0ZM45 27h10v6l15 5 6 12-2 30 4 30-6 2-6-30 0-25-2 40 4 12-2 40-4 22 2 20h-8l-2-20-2-45-2-20-2 20-2 45-2 20h-8l2-20-4-22-2-40 4-12-2-40 0 25-6 30-6-2 4-30-2-30 6-12 15-5Z';
export function muscleMapSVG(view, primary = [], secondary = [], opt = {}) {
  const shapes = view === 'back' ? B : F, P = new Set(primary), S = new Set(secondary), sel = new Set(opt.selected || []);
  const c = opt.colors || { base: '#3a414c', p: '#ff5a3c', s: '#ffb199', sil: '#232830', sel: '#4da3ff' };
  let out = `<svg viewBox="0 0 100 214" class="mmap" role="img" aria-label="${view === 'back' ? '背面' : '正面'}肌肉图"><path d="${SIL}" fill="${c.sil}"/><path d="${FEET}" fill="${c.sil}"/>`;
  for (const [id, pts] of Object.entries(shapes)) {
    const fill = P.has(id) ? c.p : S.has(id) ? c.s : sel.has(id) ? c.sel : c.base;
    for (const side of [pts, pts.map(([x, y]) => [100 - x, y])])
      out += `<polygon data-m="${id}" points="${side.map(q => q.join(',')).join(' ')}" fill="${fill}" stroke="#15181d" stroke-width=".6" stroke-linejoin="round"><title>${MUSCLES[id]}</title></polygon>`;
  }
  return out + '</svg>';
}
