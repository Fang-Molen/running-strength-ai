// 安全区模拟（JS 里 Tailwind 任意值类名如 pb-[max(…,env(…))] 不替换，否则类名对不上 CSS）：拦截 CSS/JS，把 env(safe-area-inset-*) 换成 iPhone 15/16 Pro 竖屏数值（上 59 / 下 34），并模拟 standalone 显示模式。
export async function emulateSafeArea(ctx,{top=59,bottom=34}={}){
  await ctx.route(/\.(css|js)(\?.*)?$/,async r=>{const res=await r.fetch();let body=await res.text();const js=/\.js(\?|$)/.test(r.request().url());const la=js?'(?![^\\s"\'`]*\\])':''
    for(const [side,v] of [['top',top],['bottom',bottom],['left',0],['right',0]])body=body.replace(new RegExp('env\\(\\s*safe-area-inset-'+side+'\\s*(,[^)]*)?\\)'+la,'g'),v+'px')
      .replace(/\(display-mode:\s*standalone\)/g,'(min-width: 0px)')
    await r.fulfill({response:res,body,headers:{...res.headers(),'content-length':String(Buffer.byteLength(body))}})})
}
export const overlayJs=(top,bottom)=>`document.addEventListener('DOMContentLoaded',()=>{document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;top:0;left:0;right:0;height:${top}px;z-index:99999;pointer-events:none;display:flex;align-items:center;justify-content:space-between;padding:0 34px;font:600 16px system-ui;color:#fff"><span>22:53</span><span>5G ▮▮▮</span></div><div style="position:fixed;top:11px;left:50%;transform:translateX(-50%);width:126px;height:37px;border-radius:20px;background:#000;z-index:100000;pointer-events:none"></div><div style="position:fixed;bottom:8px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:#fff;z-index:99999;pointer-events:none"></div>')})`
