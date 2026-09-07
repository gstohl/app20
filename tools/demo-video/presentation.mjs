// Recording-only Playwright presentation layer. Never shipped to the app.
import {mkdir,writeFile} from 'node:fs/promises';
const sessions=new WeakMap();
let patched=false;
export async function presentation(page,name){
 const started=Date.now();
 const marks=[];
 const session={page,x:90,y:120};sessions.set(page,session);
 await page.addInitScript(()=>{
  const mount=()=>{
   const cursor=document.createElement('div');cursor.id='app20-demo-pointer';
   cursor.style.cssText='position:fixed;left:90px;top:120px;width:30px;height:38px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px #000)';
   cursor.innerHTML='<svg width="30" height="38" viewBox="0 0 30 38"><path d="M3 2L3 29L10 22L16 35L22 32L16 19L27 19Z" fill="white" stroke="#131313" stroke-width="2"/></svg>';
   document.documentElement.append(cursor);
   document.addEventListener('mousemove',event=>{cursor.style.left=event.clientX+'px';cursor.style.top=event.clientY+'px';},true);
   document.addEventListener('pointerdown',event=>{
    const ring=document.createElement('div');ring.style.cssText=`position:fixed;left:${event.clientX-22}px;top:${event.clientY-22}px;width:44px;height:44px;border:3px solid #ff8b46;border-radius:50%;pointer-events:none;z-index:2147483646;background:#ff8b4633`;
    document.documentElement.append(ring);ring.animate([{transform:'scale(.5)',opacity:1},{transform:'scale(1.5)',opacity:0}],{duration:750}).finished.then(()=>ring.remove());
   },true);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
 });
 async function point(locator){
  await locator.waitFor({state:'visible'});
  const scrolled=await locator.evaluate(el=>{
   const r=el.getBoundingClientRect();let clipped=r.top<90||r.bottom>innerHeight-70;
   for(let p=el.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll/.test(s.overflowY)){const b=p.getBoundingClientRect();if(r.top<b.top+20||r.bottom>b.bottom-20)clipped=true;}}
   if(clipped)el.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
   return clipped;
  });
  if(scrolled)await page.waitForTimeout(1100);
  const b=await locator.boundingBox();if(!b)return;
  const x=b.x+b.width/2,y=b.y+b.height/2,fromX=session.x,fromY=session.y;
  for(let i=1;i<=24;i++){const t=i/24,e=t*t*(3-2*t);await page.mouse.move(fromX+(x-fromX)*e,fromY+(y-fromY)*e);await page.waitForTimeout(18);}
  session.x=x;session.y=y;
  await page.waitForTimeout(350);
 }
 session.point=point;
 if(!patched){
  patched=true;
  const prototype=Object.getPrototypeOf(page.locator('body'));
  for(const method of ['click','fill','check','selectOption','focus','scrollIntoViewIfNeeded']){
   const original=prototype[method];
   prototype[method]=async function(...args){
    const active=sessions.get(this.page());if(!active)return original.apply(this,args);
    await active.point(this);
    let result;
    if(method==='fill' && args[0].length>0 && args[0].length<100 && !(await this.getAttribute('type')==='password')){
     await original.call(this,'',args[1]);await this.pressSequentially(args[0],{delay:65});
    }else if(method!=='scrollIntoViewIfNeeded')result=await original.apply(this,args);
    await active.page.waitForTimeout(method==='click'?1000:450);
    return result;
   };
  }
 }
 return {
  point,
  hold:seconds=>page.waitForTimeout(seconds*1000),
  mark:async title=>{marks.push({title,start:(Date.now()-started)/1000});await mkdir('artifacts/hackathon',{recursive:true});await writeFile(`artifacts/hackathon/${name}-chapters.json`,JSON.stringify(marks,null,2)+'\n');},
 };
}
