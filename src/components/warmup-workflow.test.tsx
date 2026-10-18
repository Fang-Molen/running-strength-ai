import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { WarmupEditor } from './warmup-editor';
import { WarmupDemoSheet } from './warmup-player';
import { ShapeSim3D } from './shape-sim-3d';
import { warmupPreset } from '@/lib/ui/warmup';
test('warm-up editor exposes distinct sport choices, four budgets, explicit rests and main-prep load', () => {
  const html = renderToStaticMarkup(<WarmupEditor value={warmupPreset('strength',15)} onChange={() => {}} type="strength" main={[{name:'深蹲',catalogId:'back-squat'}]} />);
  for (const s of ['5分钟','15分钟','30分钟','40分钟','轻松跑准备','速度／间歇准备','力量·上肢','力量·下肢','组间休息','预备组总负重','请选择本次主项']) assert.ok(html.includes(s));
  assert.match(html, /aria-label="热身时间预算"/);
});
test('unapproved warmup shows the correct text and new reference without a false 3D player', () => {
 const step=warmupPreset('quality-run',15).steps.find(s=>s.actionId==='a-skip')!;
 const html=renderToStaticMarkup(<WarmupDemoSheet step={step} onClose={()=>{}}/>);
 assert.match(html,/非当前热身动作姿势/);assert.match(html,/还未通过审核/);assert.match(html,/返回热身/);
 assert.match(html,/fangkun-character/);assert.doesNotMatch(html,/<canvas|真实3D热身动作|viewer3d/);
});
test('male preview preserves measured and target numbers while explicitly disabling unapproved morphing',()=>{
 const html=renderToStaticMarkup(<ShapeSim3D sex="male" cur={{kg:56,bf:9}} tgt={{kg:60,bf:null}}/>);
 assert.match(html,/当前记录 56 kg/);assert.match(html,/目标体重 60 kg/);assert.match(html,/不调用旧版人体/);assert.match(html,/参考图不会随滑杆变形/);
 assert.match(html,/male-front.webp/);assert.match(html,/visibility:hidden/);assert.match(html,/aria-hidden="true"/);assert.doesNotMatch(html,/female-front.webp|demo3d\/models/);
});
test('female reference is distinct and never claims to be a body scan or approved animation',()=>{
 const html=renderToStaticMarkup(<ShapeSim3D sex="female" cur={{kg:56,bf:15}} tgt={{kg:60,bf:null}}/>);
 assert.match(html,/female-front.webp/);assert.match(html,/不是通过体重、体脂自动计算的人体外形/);
 assert.match(html,/体脂 15%/);assert.match(html,/visibility:hidden/);assert.doesNotMatch(html,/\/male-front.webp"|demo3d\/models/);
});
