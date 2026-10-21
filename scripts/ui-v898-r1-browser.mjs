/** Local acceptance: media fixtures are the original R4 drafts, never generated test animations.
 * FK_QA_URL must be a local dev/preview URL. Does not use personal records or paid models. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url=process.env.FK_QA_URL||'http://127.0.0.1:8080';
assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Only use a disposable local preview');
const dir=process.env.FK_QA_SCREENSHOTS||'/workspace/screenshots/fk-v898-r1';mkdirSync(dir,{recursive:true});
const matrix=process.env.FK_QA_WIDTHS?JSON.parse(process.env.FK_QA_WIDTHS):[[320,740],[375,812],[390,844],[414,896],[768,1024],[1280,800]];
const results=[];
for(const [width,height] of matrix) {
 const row={width,height,checks:[],pageErrors:[],httpErrors:[]};let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:process.env.FK_QA_SOFTWARE==='1'?['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024,isMobile:width<600,locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>row.pageErrors.push(e.message));page.on('response',r=>{if(r.status()>=400)row.httpErrors.push({path:new URL(r.url()).pathname,status:r.status()})});
  const model=[];page.on('request',r=>{if(r.method()==='POST'&&/\/api\/(coach|ai)|deepseek/.test(r.url()))model.push(r.url())});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
  for(let i=0;i<6;i++){const b=page.getByRole('button',{name:'跳过，用默认',exact:true});if(await b.isVisible())await b.click();}
  for(const name of ['逐个调整','暂不需要']) {const b=page.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click();}
  if(await page.getByTestId('onboard-undo').isVisible())await page.getByTestId('onboard-undo').click();
  await page.getByRole('button',{name:'打开方坤',exact:true}).click();
  const tabs=page.locator('.fk-coach-tabs');await tabs.getByRole('button',{name:'学习',exact:true}).click();
  const library=page.getByRole('region',{name:'方坤运动知识库'});
  await library.getByRole('button',{name:'查看动作与热身 ↓',exact:true}).click();
  const w=page.getByTestId('warmup-drafts');await w.locator('summary').click();
  assert.equal(await w.locator('li').count(),15);row.checks.push('快捷入口与15项草案完整保留');
  const search=w.getByRole('searchbox');await search.fill('摆臂');assert.equal(await w.locator('li').count(),1);
  await search.fill('不存在动作');await w.getByRole('button',{name:'显示全部动作'}).click();assert.equal(await w.locator('li').count(),15);row.checks.push('热身搜索、空结果与恢复');
  await w.getByRole('button',{name:/徒手半蹲/}).click();let video=w.locator('video');
  await video.waitFor();await video.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('[data-testid="warmup-player"] video')?.readyState>=2);
  const m=await video.evaluate(e=>({width:e.videoWidth,height:e.videoHeight,loop:e.loop,inline:e.playsInline}));assert.ok(m.width>0&&m.height>0&&m.loop&&m.inline);
  await w.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector('[data-testid="warmup-player"] video');return v&&!v.paused&&v.currentTime>0;});row.checks.push('原R4视频实际解码与播放');
  await w.getByRole('button',{name:'正常速度',exact:true}).click();assert.equal(await video.evaluate(e=>e.playbackRate),.5);
  await w.getByRole('button',{name:'暂停',exact:true}).click();assert.equal(await video.evaluate(e=>e.paused),true);row.checks.push('暂停与0.5倍速状态同步');
  await w.getByRole('button',{name:'播放',exact:true}).click();
  await tabs.getByRole('button',{name:'对话',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="warmup-player"] video')?.paused===true);
  await tabs.getByRole('button',{name:'学习',exact:true}).click();assert.equal(await video.evaluate(e=>e.paused),true);row.checks.push('切出学习页暂停，返回不擅自重播');
  await video.scrollIntoViewIfNeeded();await w.getByRole('button',{name:'播放',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await page.waitForFunction(()=>document.querySelector('[data-testid="warmup-player"] video')?.paused===true);row.checks.push('页面离开事件暂停');
  await w.getByRole('button',{name:'播放',exact:true}).click();
  await page.evaluate(()=>{document.querySelector('[data-testid="warmup-drafts"]').open=false;});await video.waitFor({state:'detached'});
  await w.locator('summary').click();video=w.locator('video');await video.waitFor();assert.equal(await video.evaluate(e=>e.paused),true);row.checks.push('收起栏目释放播放器，重开保持暂停');
  await w.getByRole('button',{name:'男',exact:true}).click();video=w.locator('video');
  assert.match(await video.getAttribute('src'),/male_warmup_/);assert.equal(await video.evaluate(e=>e.paused),true);assert.equal(await w.getByRole('button',{name:'正常速度',exact:true}).count(),1);row.checks.push('换人物重置播放状态与倍速');
  await video.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('[data-testid="warmup-player"] video')?.readyState>=2);
  await w.getByRole('button',{name:'播放',exact:true}).click();
  await library.getByRole('searchbox',{name:'搜索运动知识、文献与关键词'}).scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('[data-testid="warmup-player"] video')?.paused===true);row.checks.push('视频滚出视口后暂停');
  // Exercise a genuine failed media response, then restore the original file.
  await page.route('**/female_warmup_hip_hinge.mp4',route=>route.fulfill({status:404,body:'not found'}));
  await w.getByRole('button',{name:'女',exact:true}).click();await w.getByRole('button',{name:/^徒手髋铰链/}).click();
  await w.getByRole('button',{name:'重新加载',exact:true}).waitFor();assert.match(await w.innerText(),/暂时无法加载/);row.checks.push('媒体失败有中文提示');
  await page.unroute('**/female_warmup_hip_hinge.mp4');await w.getByRole('button',{name:'重新加载',exact:true}).click();video=w.locator('video');
  await page.waitForFunction(()=>{const v=document.querySelector('[data-testid="warmup-player"] video');return v&&v.videoWidth>0&&!v.paused;});row.checks.push('恢复原媒体后重试可播放');
  await w.getByRole('button',{name:'暂停',exact:true}).click();
  await context.setOffline(true);await w.getByRole('button',{name:/^徒手前平举/}).click();await w.getByRole('button',{name:'重新加载',exact:true}).waitFor();
  await context.setOffline(false);await w.getByRole('button',{name:'重新加载',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="warmup-player"] video')?.videoWidth>0);row.checks.push('未缓存视频离线失败与联网重试');
  await w.getByRole('button',{name:'暂停',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="warmup-player"] video')?.paused===true);
  await w.getByRole('button',{name:'播放',exact:true}).waitFor();
  await page.screenshot({path:`${dir}/${width}-warmup.png`});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);assert.equal(overflow,false);row.checks.push('窄屏标签、播放器和操作区无横向溢出');
  await library.getByRole('button',{name:/人体肌群 3D/}).click();
  const dialog=page.getByRole('dialog',{name:'人体肌群3D',exact:true});await dialog.waitFor();
  const summary=dialog.locator('summary').filter({hasText:'按名称选择肌群'});
  await summary.focus();await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);
  await dialog.focus();await page.keyboard.press('Tab');assert.equal(await dialog.getByRole('button',{name:'关闭',exact:true}).evaluate(e=>e===document.activeElement),true);
  await dialog.getByRole('button',{name:'完成查看',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await dialog.getByRole('button',{name:'关闭',exact:true}).evaluate(e=>e===document.activeElement),true);
  await dialog.evaluate(root=>{const d=document.createElement('details');const s=document.createElement('summary');s.textContent='键盘验证说明';d.appendChild(s);root.appendChild(d);s.focus();});
  await page.keyboard.press('Tab');assert.equal(await dialog.getByRole('button',{name:'关闭',exact:true}).evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});row.checks.push('弹窗末尾summary参与焦点循环，Escape关闭');
  assert.equal(model.length,0);assert.deepEqual(row.pageErrors,[]);row.checks.push('没有付费模型请求或未捕获页面错误');
  row.status='PASS';
 } catch(error){row.status='FAIL';row.error=error.stack;} finally {if(browser)await browser.close();}
 results.push(row);console.log(JSON.stringify({width,height,status:row.status,checks:row.checks.length,error:row.error}));
}
const report={date:new Date().toISOString(),url,media:'User-owned R4 original MP4 fixtures; no assertion of professional motion review',results};
writeFileSync(process.env.FK_QA_REPORT||dir+'/results.json',JSON.stringify(report,null,2));
if(results.some(r=>r.status!=='PASS'))throw new Error('UI acceptance failed');
