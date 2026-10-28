import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MuscleActionList } from './muscle-action-list';
import { ActionPicker } from './action-picker';
import { DemoSheet } from './exercise-editor';

const noop = () => {};
test('library list: grouped by movement pattern, first group open, every row labelled with demo status, browsing writes nothing', () => {
  const html = renderToStaticMarkup(<MuscleActionList pick={null} onShow={noop} onAdd={noop} />);
  assert.match(html, /全部动作/); assert.match(html, /fk-actlib-group/);
  assert.match(html, /<details[^>]*class="fk-actlib-group"[^>]*open=""/, 'first group opens by default');
  assert.equal((html.match(/<details[^>]*class="fk-actlib-group"[^>]*open=""/g) ?? []).length, 1, 'only the first group is expanded');
  const rows = html.match(/class="fk-actlib-row"/g) ?? [];
  assert.ok(rows.length > 0);
  assert.equal((html.match(/class="fk-actlib-status"/g) ?? []).length, rows.length);
  assert.match(html, /待审核示意|暂无演示|已审核视频/);
  assert.doesNotMatch(html, /已审核视频</, 'no approved videos in the shipped manifest, so none may be claimed');
  assert.match(html, /查看动作/); assert.match(html, /加入训练/);
});
test('library list: an already selected action is disabled and says so; chips expose pressed state', () => {
  const html = renderToStaticMarkup(<MuscleActionList pick={null} onShow={noop} onAdd={noop} selected={['local:back-squat']} />);
  assert.match(html, /aria-label="已选择杠铃深蹲"[^>]*disabled=""/);
  assert.match(html, /aria-pressed="true"[^>]*>全部</);
});
test('muscle explorer mode (a part picked) keeps a flat related list instead of pattern groups', () => {
  const html = renderToStaticMarkup(<MuscleActionList pick={{ k: 'biceps_fem', g: 'hamstrings' }} onShow={noop} onAdd={noop} />);
  assert.match(html, /相关动作/); assert.doesNotMatch(html, /fk-actlib-group/);
});
test('detail sheet: only shows an action button when the caller gives one; disabled state is honest', () => {
  const plain = renderToStaticMarkup(<DemoSheet id="back-squat" onClose={noop} />);
  assert.doesNotMatch(plain, /选择此动作|加入训练/);
  const withAction = renderToStaticMarkup(<DemoSheet id="back-squat" onClose={noop} action={{ label: '选择此动作', hint: '加入后回到训练编辑器', onClick: noop }} />);
  assert.match(withAction, /选择此动作/); assert.match(withAction, /加入后回到训练编辑器/);
  const done = renderToStaticMarkup(<DemoSheet id="back-squat" onClose={noop} action={{ label: '已在本次训练', disabled: true, onClick: noop }} />);
  assert.match(done, /disabled=""[^>]*>已在本次训练/);
});
test('action picker rows show demo status and a 查看动作 entry; selecting stays explicit', () => {
  const html = renderToStaticMarkup(<ActionPicker selectedKeys={[]} onAdd={noop} onPreview={noop} onMuscle={noop} />);
  assert.match(html, /待审核示意|暂无演示/); assert.match(html, /查看动作/); assert.match(html, /＋加入/);
});
