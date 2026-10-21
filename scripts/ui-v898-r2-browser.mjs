/** R2 health navigation acceptance. Synthetic records in disposable local profiles only. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.FK_QA_URL||'http://127.0.0.1:8080';
assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
const dir=process.env.FK_QA_SCREENSHOTS||'/workspace/screenshots/fk-v898-r2';mkdirSync(dir,{recursive:true});
const matrix=process.env.FK_QA_WIDTHS?JSON.parse(process.env.FK_QA_WIDTHS):[[320,740],[375,812],[390,844],[414,896],[768,1024],[1280,800]];
const results=[];
for(const [width,height] of matrix){
 const row={width,height,checks:[],pageErrors:[],httpErrors:[]};let browser,page;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:process.env.FK_QA_SOFTWARE==='1'?['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<1024,timezoneId:'Asia/Shanghai',locale:'zh-CN',reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   localStorage.setItem('fk-onboard-v1','1');
   if(localStorage.getItem('r2-qa-seeded'))return;
   const today=new Date().toLocaleDateString('sv-SE'),shift=n=>new Date(Date.parse(today+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
   const vitals=[],extras=[],days={};
   for(let i=0;i<14;i++){
    const day=shift(-i),start=Date.parse(day+'T00:00:00+08:00'),synced=new Date(start+20*36e5).toISOString();
    for(const [kind,value,unit,stat] of [['SLEEP',7+i*.05,'hours','夜间总时长'],['HRV',60+i,'ms','夜间RMSSD'],['RHR',48+i,'bpm','日静息心率']]){
     vitals.push({id:`qa-${kind}-${day}`,kind,value,unit,observedOn:day,observedAt:null,source:'DEVICE_CONFIRMED',note:'合成测试手表',hrvMethod:kind==='HRV'?'RMSSD':null,createdAt:synced,observation:{key:`qa-${kind}-${day}`,sourceId:'qa-watch',statistic:stat,syncedAt:synced}});
    }
    for(const [metric,value] of [['STRESS',25+i],['BODY_BATTERY',80-i],['STEPS',8000+i*100]])extras.push({metric,day,value,source:'合成测试手表',observation:{key:`qa-${metric}-${day}`,sourceId:'qa-watch',statistic:metric==='BODY_BATTERY'?'日最高':'日汇总',syncedAt:synced}});
    if(i<10){const hr=[],bb=[],st=[];for(let m=0;m<20*60;m+=10){const t=start+m*6e4;hr.push([t,60+Math.round(6*Math.sin(m/90))+i]);bb.push([t,80-Math.round(m/40)-i]);st.push([t,25+Math.round(10*Math.sin(m/100))+i]);}days[day]={schemaVersion:1,source:'garmin',day,fetchedAt:synced,offsetMin:480,hr,bb,st,restingHr:48+i,sleep:[start,start+7*36e5],training:[{start:start+18*36e5,end:start+19*36e5,label:'合成跑步'}]};}
   }
   localStorage.setItem('fr255-vitals-v1',JSON.stringify({schemaVersion:1,records:vitals}));localStorage.setItem('fk-device-extra-v1',JSON.stringify(extras));localStorage.setItem('fk-garmin-intraday-v1:local',JSON.stringify({schemaVersion:1,days}));
   localStorage.setItem('fk-watch-v1',JSON.stringify({watch:'pro',tier:'pro',brand:'garmin'}));
   localStorage.setItem('r2-qa-seeded',today);
  });
  page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>row.pageErrors.push(e.message));page.on('response',r=>{if(r.status()>=400)row.httpErrors.push({path:new URL(r.url()).pathname,status:r.status()})});
  const paid=[];page.on('request',r=>{if(r.method()==='POST'&&/deepseek|\/api\/(coach|ai)/.test(r.url()))paid.push(r.url())});
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
  for(const name of ['暂不需要','逐个调整']){const b=page.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click();}
  if(await page.getByTestId('onboard-undo').isVisible())await page.getByTestId('onboard-undo').click();
  await page.getByRole('button',{name:'切换到健康',exact:true}).click();
  const health=page.getByTestId('health-v89'),nav=health.getByRole('navigation',{name:'健康分区'}),chart=health.getByRole('region',{name:'健康趋势',exact:true});
  const metric=label=>chart.getByRole('group',{name:'趋势指标',exact:true}).getByRole('button',{name:label,exact:true});
  const period=label=>chart.getByRole('group',{name:'趋势时间范围'}).getByRole('button',{name:label,exact:true});
  const today=await page.evaluate(()=>localStorage.getItem('r2-qa-seeded')),shift=n=>new Date(Date.parse(today+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
  const protectedKeys=['fr255-strength-plan-v3','fr255-events-v1','fr255-vitals-v1','fk-device-extra-v1','fk-garmin-intraday-v1:local'];
  const records=()=>page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),protectedKeys);const before=await records();
  const check=x=>row.checks.push(x),noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  assert.deepEqual(await nav.getByRole('button').allTextContents(),['恢复与趋势','身体与记录']);assert.equal(await chart.count(),1);assert.equal(await page.getByRole('navigation',{name:'主导航'}).getByRole('button').count(),6);check('5个健康分区合并为2个，主导航保留');
  await page.screenshot({path:`${dir}/${width}-overview.png`});await noOverflow();
  await metric('压力').click();await chart.getByTestId('h89-chart-st').waitFor();assert.equal(await chart.locator('svg[data-testid^=h89-chart-]').count(),1);assert.equal(await page.getByRole('dialog').count(),0);check('压力在同一图表切换，无重复图表或新页面');
  await chart.getByTestId('h89-chart-st').click({position:{x:100,y:70}});await chart.getByTestId('pick-label').waitFor();check('曲线点选读数可用');
  await chart.locator('summary').filter({hasText:'逐小时读数与来源'}).click();assert.equal(await chart.locator('.fk-h89-hours span').count(),20);await chart.locator('summary').filter({hasText:'逐小时读数与来源'}).click();check('逐时样本和来源就地展开');
  await period('7天').click();assert.match(await chart.getByTestId('health-metric-summary').innerText(),/25/);assert.match(await chart.getByTestId('trend-coverage').innerText(),/7 天有数据/);check('压力日汇总与逐时样本分开标注');
  await health.getByRole('button',{name:'前一天',exact:true}).click();
  assert.equal(await health.getByLabel('选择日期',{exact:true}).inputValue(),shift(-1));assert.match(await chart.getByTestId('health-metric-summary').innerText(),/26/);
  await chart.locator('summary').filter({hasText:'每日记录'}).click();assert.doesNotMatch(await chart.locator('.fk-h89-history-list').innerText(),new RegExp(today));check('历史日期的数值和范围同步，不混入未来记录');
  await health.getByRole('button',{name:'今天',exact:true}).click();assert.equal(await health.getByLabel('选择日期',{exact:true}).inputValue(),today);check('一键回到今天');
  await health.getByTestId('h89-tile-HRV').click();assert.equal(await metric('HRV').getAttribute('aria-pressed'),'true');assert.equal(await period('7天').getAttribute('aria-pressed'),'true');assert.match(await chart.getByTestId('health-metric-summary').innerText(),/60/);assert.equal(await page.getByRole('dialog').count(),0);check('指标卡直达同页HRV趋势');
  await chart.locator('summary').filter({hasText:'来源与比较依据'}).click();await chart.getByRole('combobox',{name:'显示与分析使用的来源'}).waitFor();await chart.locator('summary').filter({hasText:'来源与比较依据'}).click();check('来源选择与比较依据仍可访问');
  await metric('睡眠').click();await chart.getByText('补录睡眠或休息',{exact:true}).click();await chart.getByRole('textbox',{name:'休息最少分钟'}).fill('20');await chart.getByRole('textbox',{name:'休息最多分钟'}).fill('30');
  await health.getByRole('button',{name:'前一天',exact:true}).click();await chart.getByText('补录睡眠或休息',{exact:true}).click();assert.equal(await chart.getByRole('textbox',{name:'休息最少分钟'}).inputValue(),'');await health.getByRole('button',{name:'今天',exact:true}).click();check('睡眠补录保留，切日期清理未提交草稿');
  await health.getByLabel('选择日期',{exact:true}).fill(shift(-15));await health.getByLabel('选择日期',{exact:true}).focus();await page.getByRole('navigation',{name:'主导航'}).waitFor({state:'visible'});await health.getByLabel('选择日期',{exact:true}).press('Tab');await metric('压力').click();await chart.getByTestId('intraday-empty').waitFor();assert.equal(await chart.locator('svg[data-testid^=h89-chart-]').count(),0);await period('30天').click();assert.match(await chart.getByTestId('health-metric-summary').innerText(),/暂无/);check('无数据日期不补零、不替换成别天曲线');
  await health.getByRole('button',{name:'今天',exact:true}).click();await metric('身体电量').click();
  await health.getByRole('button',{name:'记录疲劳与疼痛',exact:true}).click();const feelings=health.getByRole('region',{name:'主观感受'});await feelings.getByRole('button',{name:'很累',exact:true}).click();await feelings.getByRole('button',{name:'不疼',exact:true}).click();assert.equal(await page.evaluate(d=>JSON.parse(localStorage.getItem('fk-checkin-v1')).find(x=>x.date===d)?.fatigue,today),'tired');
  await health.getByText('疲劳与疼痛历史',{exact:true}).click();await health.getByRole('group',{name:'主观记录指标'}).getByRole('button',{name:'疼痛',exact:true}).click();await health.getByRole('region',{name:'酸痛历史趋势'}).waitFor();await health.getByRole('button',{name:'收起记录',exact:true}).click();check('疲劳疼痛直接记录，历史查看保留');
  await nav.getByRole('button',{name:'身体与记录',exact:true}).click();await health.getByRole('button',{name:/身体数据/}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await health.getByText('健康数据补录与历史',{exact:true}).click();await health.locator('#body-vitals[open]').waitFor();await health.getByText('健康数据补录与历史',{exact:true}).click();check('身体数据可键盘打开，补录不再藏在旧子页');
  await nav.getByRole('button',{name:'恢复与趋势',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('fk-open-health-records')));await health.locator('#body-device-records[open]').waitFor();assert.equal(await nav.getByRole('button',{name:'身体与记录',exact:true}).getAttribute('aria-pressed'),'true');check('设备记录入口自动展开正确分区');
  await nav.getByRole('button',{name:'恢复与趋势',exact:true}).click();await context.setOffline(true);await metric('HRV').click();assert.match(await chart.getByTestId('health-metric-summary').innerText(),/60/);await context.setOffline(false);check('已保存记录离线切换可用');
  await metric('心率').click();await period('7天').click();assert.match(await chart.innerText(),/静息心率/);await period('当天').click();await chart.getByTestId('h89-chart-hr').waitFor();check('心率全天与静息心率多日语义明确');
  for(const loc of [nav.getByRole('button'),chart.getByRole('group',{name:'趋势指标'}).getByRole('button'),chart.getByRole('group',{name:'趋势时间范围'}).getByRole('button')])for(const b of await loc.all()){const r=await b.boundingBox();assert.ok(r&&r.height>=44)}
  await page.evaluate(()=>document.documentElement.style.fontSize='20px');await noOverflow();await page.evaluate(()=>document.documentElement.style.fontSize='');check('主要触控目标至少44px，放大文字无横向溢出');
  await chart.scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/${width}-trend.png`});
  await page.getByRole('button',{name:'切换到饮食',exact:true}).click();assert.equal(await page.getByRole('button',{name:'营养建议与练前练后 ›',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'练前练后怎么吃 ›',exact:true}).count(),0);await noOverflow();check('饮食同目标入口合并，页面宽度收敛');
  assert.deepEqual(await records(),before);assert.deepEqual(row.pageErrors,[]);assert.equal(paid.length,0);check('浏览不改训练或手表数据，无模型调用与JS异常');
  row.status='PASS';
 }catch(e){row.status='FAIL';row.error=e.stack;if(page)try{await page.screenshot({path:`${dir}/${width}-failure.png`})}catch{}}finally{await browser?.close()}
 results.push(row);console.log(JSON.stringify({width,status:row.status,checks:row.checks.length,error:row.error}));
}
writeFileSync(process.env.FK_QA_REPORT||dir+'/results.json',JSON.stringify({date:new Date().toISOString(),url,scope:'Synthetic health records; local UI only, not physical iOS or real sync',results},null,2));
if(results.some(r=>r.status!=='PASS'))throw Error('R2 acceptance failed');
