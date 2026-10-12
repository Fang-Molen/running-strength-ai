import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = readFileSync(resolve(root, 'src/components/strength-app.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');

test('five destinations and personal settings remain exactly in their agreed locations', () => {
  const nav = app.slice(app.indexOf('<nav className="ui03-dock'), app.indexOf('{picker ? ('));
  for (const text of ['["today", "今日", House]', '["plan", "计划", ClipboardList]', '["log", "日志", CalendarDays]', '["coach", "方坤", MessageCircle]', '["body", "身体", Scale]']) {
    assert.ok(nav.includes(text), text);
  }
  assert.match(nav, /aria-current=\{tab === id \? "page" : undefined\}/);
  assert.match(app, /aria-label="个人与数据"/);
});

test('shared shell and five-page navigation have consistent style hooks', () => {
  for (const hook of ['ui03-header', 'ui03-title', 'ui03-settings', 'ui03-main', 'ui03-dock-inner', 'ui03-tab-icon']) {
    assert.ok(app.includes(hook), `missing JSX hook ${hook}`);
    assert.ok(css.includes(`.${hook}`), `missing CSS selector ${hook}`);
  }
});

test('mobile, accessibility, and dark mode overrides are present', () => {
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('UI change does not introduce save, storage or online calls in stylesheet', () => {
  assert.doesNotMatch(css, /localStorage|fetch\(|dispatchEvent\(|savePlan\(/);
});
