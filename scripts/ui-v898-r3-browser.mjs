/** R3 local UI acceptance; all records are synthetic and profiles disposable. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.FK_QA_URL||'http://127.0.0.1:8080';assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const dir=process.env.FK_QA_SCREENSHOTS||'/workspace/screenshots/fk-v898-r3';mkdirSync(dir,{recursive:true});
const matrix=process.env.FK_QA_WIDTHS?JSON.parse(process.env.FK_QA_WIDTHS):[[320,740],[375,812],[390,844],[414,896],[768,1024],[1280,800]];
const results=[];
for(const [width,height] of matrix){
 let browser,page;const row={width,height,checks:[],pageErrors:[],httpErrors:[]};
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:process.env.FK_QA_SOFTWARE==='1'?['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<1024,timezoneId:'Asia/Shanghai',locale:'zh-CN',reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   localStorage.setItem('fk-onboard-v1','1');if(localStorage.getItem('r3-seeded'))return;
   const now=new Date(),today=now.toLocaleDateString('sv-SE'),shift=n=>new Date(Date.parse(today+'T12:00:00Z')+n*864e5).toISOString().slice(0,10),day=shift(-1),prev=shift(-2),at=(d,t)=>Date.parse(d+'T'+t+':00+08:00');
   const train={start:at(day,'18:00'),end:at(day,'19:00'),label:'合成跑步'};
   const base=d=>({schemaVersion:1,source:'garmin',day:d,fetchedAt:now.toISOString(),offsetMin:480,hr:[],bb:[],st:[],restingHr:null,sleep:null,training:[]});
   const d={...base(day),hr:[[at(day,'08:00'),60]],bb:[[at(day,'08:00'),60]],sleep:[at(prev,'23:00'),at(day,'07:00')],training:[train]};
   localStorage.setItem('fk-garmin-intraday-v1:local',JSON.stringify({schemaVersion:1,days:{[day]:d,[today]:{...base(today),training:[train]}}}));
   const rest=(id,patch)=>({athleteId:'local',sourceNamespace:'self:local',originEventId:id,transport:'SELF_REPORT',transportRecordId:id,revision:1,knownAt:now.getTime(),removed:false,kind:'NAP',form:'DURATION_ESTIMATE',duration:{low:20,high:null},contextDay:day,sourceEpisodeId:null,inclusion:'UNKNOWN',protocol:'SELF_REPORTED_Asia/Shanghai',occurredStart:null,occurredEnd:null,...patch});
   for(const r of [rest('qa-estimate',{}),rest('qa-interval',{form:'INTERVAL',duration:null,occurredStart:at(day,'13:00'),occurredEnd:at(day,'13:30')})])localStorage.setItem('fr255-recovery-rest-v1:local:'+r.originEventId,JSON.stringify({schemaVersion:1,data:{schema:'FK-REST-U01',record:r}}));
   localStorage.setItem('r3-seeded',day);
  });
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>row.pageErrors.push(e.message));page.on('response',r=>{if(r.status()>=400)row.httpErrors.push({path:new URL(r.url()).pathname,status:r.status()})});
  const paid=[];page.on('request',r=>{if(r.method()==='POST'&&/deepseek|\/api\/(coach|ai)/.test(r.url()))paid.push(r.url())});
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
  for(const name of ['暂不需要','逐个调整']){const b=page.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click()}
  if(await page.getByTestId('onboard-undo').isVisible())await page.getByTestId('onboard-undo').click();
  const protectedData=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/^(fk-garmin-intraday|fr255-recovery-rest|fr255-events|fr255-strength-plan|fr255-vitals)/.test(k))));const before=await protectedData();
  const check=s=>row.checks.push(s),noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  await page.getByRole('button',{name:'切换到健康',exact:true}).click();const health=page.getByTestId('health-v89');
  const day=await page.evaluate(()=>localStorage.getItem('r3-seeded'));await health.getByLabel('选择日期',{exact:true}).fill(day);await health.getByLabel('选择日期',{exact:true}).press('Tab');
  await health.locator('summary').filter({hasText:'睡眠与训练时段'}).click();const events=health.getByTestId('h89-events');
  assert.match(await events.innerText(),/已记录 4 项/);assert.equal(await events.getByText('合成跑步',{exact:true}).count(),1);check('跨日副本去重，心率采样结束后的真实训练仍显示');
  assert.match(await events.innerText(),/前一天 23:00–07:00/);assert.match(await events.innerText(),/时段 8小时 · 当天 7小时/);assert.match(await events.innerText(),/UTC\+08:00/);check('历史日期晚同步可读，跨午夜保留完整时长和当天部分');
  assert.match(await events.innerText(),/13:00–13:30/);assert.match(await events.innerText(),/至少 20 分钟/);assert.match(await events.innerText(),/未填写具体时刻/);assert.match(await events.innerText(),/结束时刻按活动时长估算/);check('补记区间、时刻未知和估算结束时刻分别说明');
  await events.scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/${width}-events.png`});await noOverflow();
  await health.getByRole('button',{name:'今天',exact:true}).click();assert.match(await events.innerText(),/已记录 0 项/);assert.doesNotMatch(await events.innerText(),/合成跑步|前一天 23:00/);check('切回当天不会混入昨天已结束的事件');
  await page.getByRole('button',{name:'打开方坤',exact:true}).click();await page.locator('.fk-coach-tabs').getByRole('button',{name:'学习',exact:true}).click();
  const lib=page.getByRole('region',{name:'方坤运动知识库'}),search=lib.getByRole('searchbox'),cards=lib.locator('[data-knowledge-id]');
  assert.equal(await lib.getByRole('tab',{name:'读知识',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await cards.count(),8);assert.doesNotMatch(await lib.innerText(),/待专业审核|研究笔记|Session|Component|Block|Step/);check('默认只读科普，没有研发说明和草稿混排');
  const searchBox=await search.boundingBox(),bar=await page.locator('.fk-coach-bar').boundingBox();assert.ok(searchBox&&bar&&searchBox.y>=bar.y+bar.height);await noOverflow();await page.screenshot({path:`${dir}/${width}-library.png`});
  await lib.getByRole('button',{name:'力量',exact:true}).click();const article=lib.locator('[data-knowledge-id="EDU007"]');await article.locator(':scope > summary').click();
  assert.match(await article.innerText(),/能举多重、肌肉多大、发力多快/);assert.equal(await article.getByTestId('reading-points').locator('li').count(),3);assert.equal(await article.locator('.fk-learning-sources').getAttribute('open'),null);check('力量知识先给结论和三个要点，来源默认折叠');
  await article.scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/${width}-article.png`});
  await lib.locator('[data-knowledge-id="EDU008"] > summary').click();assert.equal(await article.getAttribute('open'),null);check('展开下一篇会收起上一篇');
  await article.locator(':scope > summary').click();await article.locator('.fk-learning-sources > summary').click();assert.match(await article.innerText(),/最大力量通常关注高负荷动作能力/);check('简述之外仍可核对原说明和适用限制');
  await lib.locator('.fk-learning-settings > summary').click();const permission=lib.getByRole('checkbox',{name:'允许打开公开文献原文'});await permission.uncheck();assert.equal(await article.locator('a[href]').count(),0);await permission.check();assert.ok(await article.locator('a[href]').count()>0);
  await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine);await page.waitForTimeout(100);assert.equal(await article.locator('a[href]').count(),0);assert.match(await article.innerText(),/能举多重/);await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine);await page.waitForTimeout(100);check('来源开关和离线阅读保留，不自动外连');
  await lib.locator('.fk-learning-settings > summary').click();await article.getByRole('button',{name:'让方坤讲简单点 ›',exact:true}).click();const question=page.getByRole('textbox',{name:'输入你的问题'});assert.doesNotMatch(await question.inputValue(),/EDU|资料编号/);await page.getByRole('button',{name:'发送',exact:true}).click();const answer=page.getByTestId('learning-answer');await answer.waitFor();assert.match(await answer.innerText(),/增肌：肌肉体积的变化/);assert.match(await answer.innerText(),/不一定同比例提高/);check('提问和回答使用普通语言，保留知识边界');
  await page.getByRole('button',{name:'返回刚才的知识阅读 ›',exact:true}).click();assert.equal(await article.getAttribute('open'),'');assert.equal(await article.locator('.fk-learning-sources').getAttribute('open'),'');check('返回保留文章及来源展开状态');
  await search.fill('能举多重');assert.ok(await lib.locator('[data-knowledge-id="EDU007"]').count());await search.fill('ＨＲＶ');assert.ok(await cards.count()>0);await search.fill('不存在词条XYZ');assert.equal(await cards.count(),0);await lib.getByRole('button',{name:'查看全部',exact:true}).click();check('新文案与原关键词可搜索，空结果可返回');
  await lib.getByRole('tab',{name:'读知识',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await lib.getByRole('tab',{name:'查资料',exact:true}).getAttribute('aria-selected'),'true');assert.match(await lib.innerText(),/待专业审核/);await lib.getByRole('combobox',{name:'资料类型'}).selectOption('literature');assert.ok(await cards.count()>0);check('研究草稿和参考文献保留在查资料中，支持键盘');
  if(width===390){await lib.getByRole('combobox',{name:'资料类型'}).selectOption('all');for(let i=0;i<16;i++){const more=lib.getByRole('button',{name:/再看一些/});if(!await more.count())break;await more.click()}assert.equal(await cards.count(),123);await lib.getByRole('tab',{name:'读知识',exact:true}).click();for(let i=0;i<8;i++){const more=lib.getByRole('button',{name:/再看一些/});if(!await more.count())break;await more.click()}assert.equal(await cards.count(),61)}
  check('目录保留（390px实际翻完61篇知识与123条全库）');
  await lib.getByRole('tab',{name:'读知识',exact:true}).click();await page.evaluate(()=>document.documentElement.style.fontSize='20px');await noOverflow();await page.evaluate(()=>document.documentElement.style.fontSize='');assert.deepEqual(await protectedData(),before);assert.deepEqual(row.pageErrors,[]);assert.equal(paid.length,0);check('放大文字无溢出，浏览未改训练数据、无模型调用或JS异常');
  row.status='PASS';
 }catch(e){row.status='FAIL';row.error=e.stack;if(page)try{await page.screenshot({path:`${dir}/${width}-failure.png`})}catch{}}finally{await browser?.close()}
 results.push(row);console.log(JSON.stringify({width,status:row.status,checks:row.checks.length,error:row.error}));
}
writeFileSync(process.env.FK_QA_REPORT||dir+'/results.json',JSON.stringify({date:new Date().toISOString(),url,scope:'Local synthetic data; not physical iOS, real sync or deployment',results},null,2));if(results.some(r=>r.status!=='PASS'))throw Error('R3 browser acceptance failed');
