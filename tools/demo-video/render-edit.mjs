// Remotion draws the chapter artwork; FFmpeg composites captured footage at 1×.
// This avoids re-rendering unchanged text for all 5,400 frames.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill} from '@remotion/renderer';
import {chromium} from '@playwright/test';
const directory=dirname(fileURLToPath(import.meta.url));
const plan=JSON.parse(await readFile(process.argv[2]??'artifacts/hackathon/video-plan.json','utf8'));
if(plan.clips.reduce((sum,c)=>sum+c.seconds,0)!==180)throw Error('Expected exactly 180 seconds');
if(plan.transactions?.length)throw Error('This edit is a rehearsal, not verified mainnet evidence');
for(const clip of plan.clips){if(!clip.label||!(clip.seconds>0)||!(clip.sourceSeconds>0)||clip.sourceSeconds>clip.seconds)throw Error('Every clip requires a label and a positive source duration no longer than the chapter');}
const destination=resolve('artifacts/hackathon/edit-v2');await mkdir(destination,{recursive:true});
const serveUrl=await bundle({entryPoint:resolve(directory,'Root.tsx')});
const browserExecutable=chromium.executablePath();
const inputProps={...plan,transactions:[],overlayOnly:true};
const composition=await selectComposition({serveUrl,id:'APP20Demo',inputProps,browserExecutable});
async function run(command,args){await new Promise((ok,fail)=>{const p=spawn(command,args,{stdio:['ignore','ignore','pipe']});let stderr='';p.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-6000));p.on('error',fail);p.on('exit',code=>code===0?ok():fail(Error(stderr)));});}
let offset=0;
for(const [index,clip]of plan.clips.entries()){
 const overlay=resolve(destination,`${index}.png`),output=resolve(destination,`${index}.mp4`);
 await renderStill({serveUrl,composition,inputProps,browserExecutable,frame:Math.round(offset*30),output:overlay,imageFormat:'png'});
 const frames=Math.round(clip.seconds*30);
 const crop=clip.crop ? `crop=${clip.crop.width}:${clip.crop.height}:${clip.crop.x}:${clip.crop.y},` : "";
 await run('ffmpeg',['-y','-ss',String(clip.start??0),'-t',String(clip.sourceSeconds),'-i',resolve(clip.file),'-i',overlay,'-filter_complex',`[0:v]${crop}setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=${clip.seconds},scale=1850:825:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:100:black,setsar=1[footage];[footage][1:v]overlay=0:0,format=yuv420p[out]`,'-map','[out]','-an','-frames:v',String(frames),'-c:v','libx264','-preset','fast','-crf','20','-threads','4',output]);
 offset+=clip.seconds;console.log(`Rendered chapter ${index+1}/${plan.clips.length}: ${clip.title}`);
}
const {writeFile}=await import('node:fs/promises');
await writeFile(resolve(destination,'concat.txt'),plan.clips.map((_,i)=>`file '${i}.mp4'`).join('\n'));
const output=resolve('artifacts/hackathon/app20-demo-v2.mp4');
await run('ffmpeg',['-y','-f','concat','-safe','0','-i',resolve(destination,'concat.txt'),'-c','copy','-movflags','+faststart',output]);
console.log(output);
