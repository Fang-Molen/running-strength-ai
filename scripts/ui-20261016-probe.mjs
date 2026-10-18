import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const dir='/workspace/screenshots/fangkun-ui-20261016';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844}});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8096/',{waitUntil:'domcontentloaded',timeout:90000});await page.locator('[data-testid="fieldwork-view"]').waitFor({timeout:90000});await page.screenshot({path:dir+'/dev-initial.png',fullPage:true});
console.log(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,7000)},null,2));await browser.close();
