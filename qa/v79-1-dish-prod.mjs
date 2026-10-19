import {chromium} from 'playwright'
const base=process.argv[2]||'https://molen-fangkun.pages.dev'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
await ctx.addInitScript(()=>localStorage.setItem('fk-onboard-v1','1'))
const p=await ctx.newPage();p.setDefaultTimeout(20000)
let req=null,resp=null;p.on('request',r=>{if(r.url().endsWith('/api/vision')&&r.method()==='POST')req=r.postData()});p.on('response',async r=>{if(r.url().endsWith('/api/vision')&&r.request().method()==='POST'){resp={status:r.status(),body:await r.json().catch(()=>null)}}})
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(3000)
await p.getByLabel('切换到饮食').click({force:true});await p.waitForTimeout(800)
await p.getByRole('button',{name:'记录饮食',exact:true}).click();const d=p.getByRole('dialog',{name:'登记饮食',exact:true})
const s=d.getByTestId('dish-photo-status').first();await s.filter({hasText:'DeepSeek'}).waitFor();await s.click()
const sec=d.getByRole('region',{name:'拍照 / 图片识别'}).last()
await sec.locator('input[type=file]').last().setInputFiles('/workspace/out/v791/dish.jpg')
const t0=Date.now();await sec.getByRole('button',{name:'联网识别食物'}).click()
const rev=d.getByRole('region',{name:'核对食物识别结果'});await rev.waitFor({timeout:60000}).catch(()=>{})
const ms=Date.now()-t0;await p.waitForTimeout(800)
await p.screenshot({path:'/workspace/out/v791/dish-review.png',fullPage:false})
await rev.scrollIntoViewIfNeeded().catch(()=>{});await p.screenshot({path:'/workspace/out/v791/dish-review2.png'})
const j=req?JSON.parse(req):null
console.log(JSON.stringify({ms,uploadBytes:req?.length,imgChars:j?.image?.length,status:resp?.status,model:resp?.body?.model,usage:resp?.body?.usage,result:resp?.body?.result,message:resp?.body?.message,stage:resp?.body?.stage,chips:await d.getByTestId('photo-est-chip').allInnerTexts(),suggest:await d.getByTestId('photo-db-suggest').allInnerTexts()},null,1))
// dims of uploaded image
if(j?.image){const buf=Buffer.from(j.image.split(',')[1],'base64');let i=2;while(i<buf.length){if(buf[i]!==0xFF){i++;continue}const m=buf[i+1];if(m>=0xC0&&m<=0xC2){console.log('uploaded dims',buf.readUInt16BE(i+7),'x',buf.readUInt16BE(i+5));break}i+=2+buf.readUInt16BE(i+2)}}
await b.close()
