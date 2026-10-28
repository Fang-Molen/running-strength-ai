import { build } from 'esbuild';
import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const dir = new URL('./', import.meta.url);
await build({ entryPoints: [fileURLToPath(new URL('panel-fixture.tsx', dir))], outfile: fileURLToPath(new URL('panel-fixture.js', dir)), bundle: true, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
await writeFile(new URL('panel-fixture.html', dir), '<!doctype html><meta charset="utf-8"><title>Synthetic personal plan review</title><div id="root"></div><script src="./panel-fixture.js"></script>');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox', '--disable-background-networking'] });
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const fixtureOrigin = 'http://127.0.0.1:8080/__synthetic-personal/';
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url === fixtureOrigin + 'panel-fixture.html') return route.fulfill({ contentType: 'text/html', body: await readFile(new URL('panel-fixture.html', dir), 'utf8') });
    if (url === fixtureOrigin + 'panel-fixture.js') return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('panel-fixture.js', dir), 'utf8') });
    return route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixtureOrigin + 'panel-fixture.html');
  await page.getByText('私人教练 · 饮食、力量与目标', { exact: true }).click();
  await page.getByRole('button', { name: '读取我的目标', exact: true }).click();
  const before = await page.evaluate(() => window.personalFixture.active());
  await page.evaluate(() => window.personalFixture.addMeal());
  await page.getByText(/原方案保留.*待复核/).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '查看刷新候选', exact: true }).click();
  await page.getByRole('button', { name: '已核对，确认采用此版本', exact: true }).waitFor();
  await page.evaluate(() => window.personalFixture.addMeal());
  await page.getByText(/草案依据已变化/).waitFor();
  assert.equal(await page.getByRole('button', { name: '已核对，确认采用此版本', exact: true }).count(), 0);
  await page.getByRole('button', { name: '查看刷新候选', exact: true }).click();
  await page.getByRole('button', { name: '拒绝此候选，保留原方案', exact: true }).click();
  await page.getByText('已拒绝候选，原已采用方案保留；尚未核实的新依据仍需复核。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.personalFixture.active()), before);
  assert.equal(await page.evaluate(() => window.personalFixture.proposal()), null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', flow: 'read adopted → meal edit → stale → refreshed preview → second edit invalidates confirmation → refresh → reject', originalVersion: before.version, adoptedUnchanged: true, consoleErrors: errors }));
} finally { await browser.close(); }
