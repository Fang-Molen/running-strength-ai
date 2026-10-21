// v89.10.2 肌群核对表生成（只读：读结构清单与动作库，写 /workspace/out 下的 md）。
import { readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore browser module
import { anatomyMeta } from '../public/demo3d/anatomy-map.js';
// @ts-ignore browser module
import { normStructure, ANATOMY_ZH } from '../public/demo3d/anatomy-zh.js';
// @ts-ignore old copy
import { anatomyMeta as oldMeta } from '/tmp/old-anatomy-map.mjs';
import { LOCAL_MUSCLE_ACTIONS, actionRole } from '../src/lib/body/muscle-actions';
import { MUSCLE_FN } from '../src/lib/body/muscle-info';
const S = JSON.parse(readFileSync(new URL('../public/demo3d/anatomy/structures.json', import.meta.url), 'utf8')) as any[];
const GZ: Record<string, string> = { chest: '胸', triceps: '肱三头肌', delt_front: '三角肌前束', lats: '背阔肌', biceps: '肱二头肌', rhomboids: '菱形肌', delt_rear: '三角肌后束', traps: '斜方肌', delt_side: '三角肌中束', forearm: '前臂', quads: '股四头肌', glutes: '臀大肌', hamstrings: '腘绳肌', erectors: '竖脊肌', adductors: '内收肌', calves: '小腿', soleus: '比目鱼肌', glute_med: '臀中肌', abs: '腹直肌/腹肌', obliques: '腹斜肌', hip_flexors: '屈髋肌', tibialis: '胫骨前肌', peroneals: '腓骨肌', foot_intrinsic: '足内在肌', gastroc_med: '腓肠肌', gastroc_lat: '腓肠肌' };
const SUGGEST: Record<string, string> = {
  'pectoralis minor': '肩胛下沉/前伸控制（如俯卧撑加（push-up plus））', 'subscapularis': '弹力带肩内旋', 'semispinalis cervicis': '颈部等长伸展（弹力带/手抗阻）',
  'semispinalis capitis': '颈部等长伸展', 'multifidus cervicis': '颈部等长伸展', 'rotatores': '鸟狗式（bird dog）', 'splenius capitis': '颈部等长伸展与旋转',
  'splenius cervicis': '颈部等长伸展与旋转', 'rectus capitis posterior major': '收下巴（chin tuck）', 'rectus capitis posterior minor': '收下巴（chin tuck）',
  'obliquus capitis superior': '收下巴（chin tuck）', 'obliquus capitis inferior': '颈部等长旋转', 'quadratus lumborum': '侧桥变式、单侧农夫行走（suitcase carry）',
  'sternocleidomastoid': '颈部等长屈曲', 'scalenus anterior': '颈部等长侧屈', 'scalenus medius': '颈部等长侧屈', 'scalenus posterior': '颈部等长侧屈',
  'abductor pollicis brevis': '握力/捏握训练（plate pinch）', 'flexor pollicis brevis': '捏握训练', 'opponens pollicis': '捏握训练',
  'oblique head of adductor pollicis': '捏握训练', 'transverse head of adductor pollicis': '捏握训练', 'abductor digiti minimi of hand': '弹力圈手指外展',
  'flexor digiti minimi brevis of hand': '握力器', 'opponens digiti minimi of hand': '捏握训练', 'set of palmar interossei of hand': '手指夹纸/内收训练',
  'set of dorsal interossei of hand': '弹力圈手指外展', 'set of lumbricals of hand': '握力器', 'piriformis': '弹力带蚌式开合（clamshell）、坐姿髋外旋',
  'gemellus superior': '弹力带蚌式开合', 'gemellus inferior': '弹力带蚌式开合', 'obturator internus': '弹力带蚌式开合', 'obturator externus': '坐姿弹力带髋外旋',
  'quadratus femoris': '坐姿弹力带髋外旋', 'popliteus': '（无常规专项，北欧腿弯举等屈膝动作有参与）',
};
const uniq = new Map<string, any>();
for (const x of S) { if (!/muscles/.test(x.layer)) continue; const key = normStructure(x.name); const u = uniq.get(key) || { key, meshes: 0, layers: new Set(), sides: new Set(), fma: new Set(), sample: x }; u.meshes++; u.layers.add(x.layer === 'deep muscles' ? '深' : '浅'); u.sides.add(x.side); u.fma.add(x.fma); uniq.set(key, u); }
const hasLatin = (s: string) => /[A-Za-z]/.test(s);
const rows: any[] = [];
for (const u of uniq.values()) {
  const m = anatomyMeta(u.sample), o = oldMeta(u.sample), row = ANATOMY_ZH[u.key];
  const flags: string = row[3] || '';
  const acts = LOCAL_MUSCLE_ACTIONS.filter(a => actionRole(a, { k: m.k, g: m.g, train: m.train }) !== 'none');
  const oldActs = LOCAL_MUSCLE_ACTIONS.filter(a => actionRole(a, { k: o.k, g: o.g }) !== 'none');
  const status = flags.includes('h') ? '不适用（面部，模型隐藏）' : flags.includes('n') ? '不适用（非训练目标）' : acts.length ? '已覆盖' : '缺口';
  rows.push({ u, m, o, flags, acts, oldActs, status, oldZhOk: !hasLatin(o.zh), oldFn: !!MUSCLE_FN[o.k] });
}
const T = rows.length, cnt = (f: (r: any) => boolean) => rows.filter(f).length;
const trainable = rows.filter(r => !r.status.startsWith('不适用'));
const meshes = (f: (r: any) => boolean) => rows.filter(f).reduce((n, r) => n + r.u.meshes, 0);
const L: string[] = [];
L.push('# 肌群核对表 v89.10.2', '', '生成：scripts/_v89102-muscle-audit.ts（读 public/demo3d/anatomy/structures.json、public/demo3d/anatomy-zh.js、动作库 src/lib/strength/demo/data.json + 足踝动作库）。',
  '名称按《人体解剖学名词》（全国科学技术名词审定委员会）写法整理，功能为教科书起止点动作；均为整理结果，**未逐条对照原书**，标“待核”的尤其需要核对。', '',
  '## 汇总', '', '| 项目 | 修改前 | 修改后 |', '|---|---|---|',
  `| 肌层网格（浅层 203 + 深层 159） | ${meshes(() => true)} | ${meshes(() => true)} |`,
  `| 左右合并后结构数 | ${T} | ${T} |`,
  `| 有中文名（结构数） | ${cnt(r => r.oldZhOk)} | ${cnt(r => !hasLatin(r.m.zh))} |`,
  `| 有中文名（网格数） | ${meshes(r => r.oldZhOk)} | ${meshes(r => !hasLatin(r.m.zh))} |`,
  `| 名称带左侧/右侧前缀 | 0 | ${meshes(r => r.u.sides.has('left') || r.u.sides.has('right'))}（中线结构 ${meshes(r => r.u.sides.has('midline'))} 个不加） |`,
  `| 有功能说明 | ${cnt(r => r.oldFn)} | ${cnt(r => !!r.m.fn)} |`,
  `| 关联到已有动作（结构数） | ${cnt(r => r.oldActs.length > 0)} | ${cnt(r => r.acts.length > 0)} |`,
  `| 非收缩结构（筋膜/肌腱/支持带/腱性） | 未标注 | ${cnt(r => r.flags.includes('f'))} |`,
  `| 待核 | — | ${cnt(r => r.flags.includes('p'))} |`,
  `| 面部肌（模型隐藏，不可点） | ${cnt(r => r.flags.includes('h'))} | ${cnt(r => r.flags.includes('h'))} |`,
  `| 非训练目标（呼吸/舌骨等） | — | ${cnt(r => r.flags.includes('n'))} |`,
  `| 缺口（可训练但动作库无对应动作） | — | ${cnt(r => r.status === '缺口')} |`, '',
  `说明：“修改前有中文名”按旧代码实际显示的文字统计；旧代码对一部分结构显示的是笼统组名（如“前臂屈肌群”）或错名（喙肱肌显示为“肱肌”、小收肌显示为“短收肌”、胸半棘肌显示为“棘肌”、小趾短屈肌显示为“足部内在肌”），这些也已改成具体名称。`,
  '动作关联只用动作库已有字段：选中结构的 k / g 出现在动作的主要肌群里 = 主要；出现在辅助肌群里，或结构的“关联训练分组”出现在动作的主要/辅助肌群里 = 辅助。没有新增任何动作。', '',
  '## 逐项（左右合并）', '', '| # | 英文原名（BodyParts3D） | 层 | 侧 | 修改前显示 | 修改后中文名 | 高亮键 k / g | 关联训练分组 | 相关动作数（前→后） | 功能 | 状态 |', '|---|---|---|---|---|---|---|---|---|---|---|');
rows.sort((a, b) => a.status.localeCompare(b.status) || a.u.key.localeCompare(b.u.key));
rows.forEach((r, i) => L.push(`| ${i + 1} | ${r.u.key} | ${[...r.u.layers].join('')} | ${[...r.u.sides].map((s: string) => ({ left: '左', right: '右', midline: '中' } as any)[s]).join('')} | ${r.o.zh.replace(/\|/g, '/')} | ${r.m.base}${r.flags.includes('p') ? '（待核）' : ''} | ${r.m.k} / ${r.m.g ?? '—'} | ${r.m.train.map((g: string) => GZ[g] || g).join('、') || '—'} | ${r.oldActs.length}→${r.acts.length} | ${r.m.fn}${r.m.rel ? `；相关肌肉：${r.m.rel}` : ''} | ${r.status} |`));
L.push('', '## 待核清单', '');
rows.filter(r => r.flags.includes('p')).forEach(r => L.push(`- ${r.m.base}（${r.u.key}）`));
L.push('', '## 缺口清单（动作库没有对应动作；以下仅为建议，未加入 App）', '', '| 中文名 | 英文 | 建议动作（仅建议） |', '|---|---|---|');
rows.filter(r => r.status === '缺口').forEach(r => L.push(`| ${r.m.base} | ${r.u.key} | ${SUGGEST[r.u.key] || '—'} |`));
const out = process.argv[2] || '/workspace/out/肌群核对表-v89.10.2.md'; writeFileSync(out, L.join('\n') + '\n');
console.log(JSON.stringify({ T, meshes: meshes(() => true), zhBefore: cnt(r => r.oldZhOk), zhBeforeMeshes: meshes(r => r.oldZhOk), zhAfter: cnt(r => !hasLatin(r.m.zh)), fnBefore: cnt(r => r.oldFn), actsBefore: cnt(r => r.oldActs.length > 0), actsAfter: cnt(r => r.acts.length > 0), pending: cnt(r => r.flags.includes('p')), gap: cnt(r => r.status === '缺口'), face: cnt(r => r.flags.includes('h')), nonTarget: cnt(r => r.flags.includes('n')), fascia: cnt(r => r.flags.includes('f')), trainable: trainable.length }));
