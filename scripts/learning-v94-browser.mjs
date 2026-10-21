/** Knowledge UI acceptance. Test with a fresh browser profile, never personal data.
 * FK_QA_URL points at an already running dev or production preview.
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is optional; normal Playwright browsers work.
 * Does not invoke models or open external literature websites. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url=process.env.FK_QA_URL||'http://127.0.0.1:8080';
const screenshots=process.env.FK_QA_SCREENSHOTS||'/workspace/screenshots/fk-v94';
const out=process.env.FK_QA_REPORT||'/workspace/screenshots/fk-v94/browser-results.json';
const matrix=process.env.FK_QA_WIDTHS?JSON.parse(process.env.FK_QA_WIDTHS):process.env.FK_QA_QUICK==='1'?[[390,844]]:[[320,740],[375,812],[390,844],[414,896],[768,1024],[1280,800]];
const results=[];
mkdirSync(screenshots,{recursive:true});

for(const [width,height] of matrix){
  const row={width,height,checks:[],pageErrors:[],consoleErrors:[],httpErrors:[]};
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,
      args:process.env.FK_QA_SOFTWARE==='1'?['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024,isMobile:width<600,deviceScaleFactor:1,timezoneId:'Asia/Shanghai',locale:'zh-CN'});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',error=>row.pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')row.consoleErrors.push(message.text())});
    page.on('response',response=>{if(response.status()>=400)row.httpErrors.push({url:new URL(response.url()).pathname,status:response.status()})});
    const modelRequests=[];
    page.on('request',request=>{if(request.method()==='POST'&&/deepseek|\/api\/coach|\/api\/ai/.test(request.url()))modelRequests.push(request.url())});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
    // Finish the ordinary first-run flow only inside this disposable profile.
    for(let step=0;step<6;step++){const skip=page.getByRole('button',{name:'跳过，用默认',exact:true});if(await skip.isVisible())await skip.click();}
    if(await page.getByRole('button',{name:'逐个调整',exact:true}).isVisible())await page.getByRole('button',{name:'逐个调整',exact:true}).click();
    if(await page.getByTestId('onboard-undo').isVisible())await page.getByTestId('onboard-undo').click();
    if(await page.getByRole('button',{name:'暂不需要',exact:true}).isVisible())await page.getByRole('button',{name:'暂不需要',exact:true}).click();
    await page.getByRole('button',{name:'打开方坤',exact:true}).click();
    await page.locator('.fk-coach-tabs').getByRole('button',{name:'学习',exact:true}).click();
    const library=page.getByRole('region',{name:'方坤运动知识库'});
    await library.waitFor();
    const search=library.getByRole('searchbox');
    const cards=library.locator('[data-knowledge-id]');
    const scroller=page.getByTestId('coach-messages');
    const check=(name)=>row.checks.push(name);
    async function noOverflow(stage){
      const m=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,width:document.documentElement.scrollWidth,scroller:document.querySelector('[data-testid="coach-messages"]').getBoundingClientRect().width}));
      assert.ok(m.width<=m.viewport+1,`${stage}: horizontal overflow ${JSON.stringify(m)}`);
    }
    await noOverflow('initial');
    const bounds=await search.boundingBox();const header=await page.locator('.fk-coach-bar').boundingBox();
    assert.ok(bounds&&header&&bounds.y>=header.y+header.height,'search covered by header');
    assert.equal(await cards.count(),8);check('学习入口、初始8条、顶栏无遮挡');
    await page.screenshot({path:`${screenshots}/${width}-library.png`});
    await library.getByRole('tab',{name:'全库 123条'}).click();
    for(let i=0;i<16;i++){const more=library.getByRole('button',{name:/继续查看/});if(!await more.count())break;await more.click();}
    assert.equal(await cards.count(),123);assert.equal(await library.getByRole('button',{name:/继续查看/}).count(),0);check('全库123条完整翻阅，无60条停滞');
    await library.getByRole('tab',{name:'基础课程 61篇'}).click();
    for(let i=0;i<8;i++){const more=library.getByRole('button',{name:/继续查看/});if(!await more.count())break;await more.click();}
    assert.equal(await cards.count(),61);check('基础课程61篇全部可见');
    await library.getByRole('tab',{name:'基础课程 61篇'}).focus();await page.keyboard.press('ArrowRight');
    assert.equal(await library.getByRole('tab',{name:'研究笔记 40条'}).getAttribute('aria-selected'),'true');
    await page.keyboard.press('Home');assert.equal(await library.getByRole('tab',{name:'全库 123条'}).getAttribute('aria-selected'),'true');check('分类标签支持键盘方向键与Home');
    await library.getByRole('button',{name:'力量与肌肉',exact:true}).click();
    await search.fill('ＨＲＶ');
    assert.equal(await library.getByRole('tab',{name:'全库 123条'}).getAttribute('aria-selected'),'true');
    assert.equal(await library.getByRole('button',{name:'全部',exact:true}).getAttribute('aria-pressed'),'true');
    assert.ok(await cards.count()>0);check('新搜索跨全库与全主题，支持全角输入');
    await search.fill('不存在词条XYZ');assert.equal(await cards.count(),0);
    await library.getByRole('button',{name:'查看全库',exact:true}).click();assert.equal(await cards.count(),8);check('无结果提示、清除筛选');
    await library.getByRole('tab',{name:'研究笔记 40条'}).click();assert.match(await library.innerText(),/待专业审核/);check('研究笔记审核标识');
    await library.getByRole('tab',{name:'文献索引 22条'}).click();
    await cards.first().locator(':scope > summary').click();
    await noOverflow('long-literature');assert.doesNotMatch(await library.innerText(),/[A-Z]{3,}_[A-Z_]+/);check('英文长标题折行、核验说明中文化');
    await search.fill('800米');
    const article=library.locator('[data-knowledge-id="EDU003"]');
    await article.locator(':scope > summary').click();
    await article.locator('.fk-learning-sources > summary').click();
    await library.locator('.fk-learning-settings > summary').click();
    await library.getByRole('checkbox',{name:'允许打开公开文献原文'}).uncheck();
    assert.equal(await article.locator('a[href]').count(),0);check('关闭文献权限后不显示外部链接');
    await library.getByRole('checkbox',{name:'允许打开公开文献原文'}).check();
    assert.ok(await article.locator('a[href^="https://"]').count()>0);check('文献权限开关接通');
    await context.setOffline(true);
    await page.waitForFunction(()=>!navigator.onLine);
    await page.waitForTimeout(100);
    assert.equal(await article.locator('a[href]').count(),0);assert.ok((await article.innerText()).includes('800米'));check('离线正文保留、外链自动停用');
    await scroller.evaluate(el=>{el.scrollTop=0});await page.waitForTimeout(100);
    const offlineNotice=page.locator('.fk-coach-shell > p').filter({hasText:'当前没有网络'});
    const noticeBox=await offlineNotice.boundingBox();const knowledgeHeading=await library.getByRole('heading',{name:'训练知识与文献',exact:true}).boundingBox();
    await page.screenshot({path:`${screenshots}/${width}-offline.png`});
    assert.ok(noticeBox&&knowledgeHeading&&knowledgeHeading.y>=noticeBox.y+noticeBox.height,`offline banner covers reading header: ${JSON.stringify({noticeBox,knowledgeHeading,scroll:await scroller.evaluate(el=>el.scrollTop)})}`);check('离线提示不遮挡学习内容');
    await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine);await page.waitForTimeout(100);
    assert.ok(await article.locator('a[href]').count()>0);check('恢复联网后外链恢复');
    await library.locator('.fk-learning-settings > summary').click();
    const ask=article.getByRole('button',{name:'问方坤：如何理解这条知识？ ›',exact:true});
    await ask.scrollIntoViewIfNeeded();await page.waitForTimeout(100);
    const savedScroll=await scroller.evaluate(el=>el.scrollTop);
    const protectedData=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>!key.startsWith('fr255-coach-v2')&&!key.startsWith('fr255-coach-network-mode'))));
    const before=await protectedData();
    await page.screenshot({path:`${screenshots}/${width}-article.png`});
    await ask.click();
    assert.match(await page.getByRole('textbox',{name:'输入你的问题'}).inputValue(),/EDU003/);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByTestId('learning-answer').waitFor();
    assert.match(await page.getByTestId('learning-answer').innerText(),/训练内容可包括有氧基础/);
    assert.match(await page.getByTestId('learning-answer').innerText(),/不能把单次1000米成绩直接换算/);
    assert.equal(modelRequests.length,0);await page.waitForTimeout(100);
    assert.deepEqual(await protectedData(),before);check('问方坤引用所选正文与限制，无模型调用及训练写入');
    await page.getByRole('button',{name:'返回刚才的知识阅读 ›',exact:true}).click();
    assert.equal(await search.inputValue(),'800米');assert.equal(await article.getAttribute('open'),'');
    assert.equal(await article.locator('.fk-learning-sources').getAttribute('open'),'');
    assert.ok(Math.abs((await scroller.evaluate(el=>el.scrollTop))-savedScroll)<=2,'reading scroll was not restored');check('返回保留关键词、展开状态和阅读位置');
    await noOverflow('return');
    await library.getByRole('button',{name:'清除搜索',exact:true}).click();
    await library.getByRole('tab',{name:'基础课程 61篇'}).click();
    await library.getByRole('button',{name:'运动营养',exact:true}).click();
    await library.getByRole('button',{name:'查看饮食记录',exact:false}).click();
    await page.locator('header').getByText('饮食',{exact:true}).waitFor();check('饮食入口跳到饮食页');
    assert.deepEqual(row.pageErrors,[],'uncaught runtime errors');
    row.status='PASS';
  }catch(error){row.status='FAIL';row.error=String(error);row.stack=error.stack;process.exitCode=1;}
  finally{await browser?.close();results.push(row);console.log(JSON.stringify(row));}
}
writeFileSync(out,JSON.stringify({url,engine:'Chromium',realAppleDevice:false,results},null,2));
