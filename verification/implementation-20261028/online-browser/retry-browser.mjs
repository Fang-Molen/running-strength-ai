import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage'] });
try {
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
  if(u.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  return route.continue();
 });
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:8080/');
 await page.evaluate(async()=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default;
  const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
  const {CoachOnlineRequest}=await import('/src/components/coach-online-request.tsx');
  const {currentAthleteId}=await import('/src/lib/core/events.ts');
  const host=document.createElement('div');host.id='retry-fixture';document.body.appendChild(host);
  createRoot(host).render(React.createElement(React.StrictMode,{},React.createElement(CoachOnlineRequest,{question:'',owner:currentAthleteId(),disabled:false,onNotice:()=>{},onAnswer:()=>{},onDismiss:()=>{}})));
 });
 await page.locator('#retry-fixture').getByText('问题需在1000字以内，且不含控制字符。',{exact:true}).waitFor();
 assert.equal(await page.locator('#retry-fixture').getByRole('button',{name:'重新分析这一问'}).count(),1,'Preparation failure must leave an explicit retry');
 await page.locator('#retry-fixture').getByRole('button',{name:'重新分析这一问'}).click();
 await page.locator('#retry-fixture').getByText('问题需在1000字以内，且不含控制字符。',{exact:true}).waitFor();
 console.log('PASS: preparation failure offers manual retry under React StrictMode');
} finally {await browser.close();}
