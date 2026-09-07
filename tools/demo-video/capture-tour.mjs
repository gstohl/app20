import {presentation} from './presentation.mjs';
// Read-only public product tour. Uses a fresh context with no connected wallet.
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const origin=process.env.APP20_DEMO_ORIGIN??'https://app20.io';
await mkdir('artifacts/hackathon/raw-tour',{recursive:true});
const browser=await chromium.launch({args:process.env.APP20_DEMO_RESOLVE ? ['--host-resolver-rules='+process.env.APP20_DEMO_RESOLVE] : []});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:'artifacts/hackathon/raw-tour',size:{width:1440,height:900}}});
 const page=await context.newPage();
 const video=page.video();
 const demo=await presentation(page,'tour');
 for(const route of ['/rfq','/rfq/maker','/agents','/chat']){
  const response=await page.goto(new URL(route,origin).href,{waitUntil:'networkidle'});
  if(!response?.ok())throw new Error(`Tour page failed: ${route}`);
  await demo.mark(route);
  const heading=page.locator('h1').first();
  if(await heading.count())await demo.point(heading);
  await demo.hold(5);
  if(route==='/rfq'){
   await demo.point(page.getByLabel('You sell (STRK)',{exact:true}));
   await demo.hold(5);
   await demo.point(page.getByLabel('Minimum you receive (USDC)',{exact:true}));
   await demo.hold(8);
  }else await demo.hold(8);
 }
 await context.close();
 await video.saveAs('artifacts/hackathon/live-product-tour.webm');
 console.log('Saved public product tour; no wallet connected or transactions submitted.');
}finally{await browser.close();}
