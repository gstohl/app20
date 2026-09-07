import React from 'react';
import {AbsoluteFill,Composition,Sequence,OffthreadVideo,staticFile,useCurrentFrame,interpolate,registerRoot} from 'remotion';

type Clip={file:string;title:string;caption:string;label:string;seconds:number;start?:number};
type Props={clips:Clip[];transactions:{hash:string;explorer:string}[];overlayOnly?:boolean};
function Demo({clips,transactions,overlayOnly=false}:Props){
 const frame=useCurrentFrame();let offset=0;
 return <AbsoluteFill style={{background:overlayOnly?'transparent':'#090a09',color:'#f4f2ec',fontFamily:'Arial, sans-serif'}}>
  <div style={{height:92,padding:'22px 48px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #3c3c37'}}><b style={{fontSize:42}}>APP<span style={{color:'#ed6929'}}>[20]</span></b><span style={{fontSize:22,marginRight:420}}>PRIVATE CHAT · RFQ · INDEPENDENT MAKERS</span></div>
  {clips.map((clip,index)=>{const from=offset;offset+=clip.seconds*30;return <Sequence key={index} from={from} durationInFrames={clip.seconds*30}>
   {!overlayOnly && <AbsoluteFill style={{top:100,bottom:155,left:35,right:35,height:'auto',width:'auto',overflow:'hidden'}}><OffthreadVideo src={staticFile(clip.file)} startFrom={(clip.start??0)*30} muted style={{height:'100%',width:'100%',objectFit:'contain'}}/></AbsoluteFill>}
   <div style={{position:'absolute',top:106,left:48,background:'#12120fee',border:'1px solid #ed6929',padding:'8px 14px',fontSize:20,color:'#f89658'}}>{clip.label}</div>
   <div style={{position:'absolute',bottom:42,left:48,right:48}}><strong style={{fontSize:32}}>{clip.title}</strong><p style={{fontSize:23,color:'#c4c5bd',margin:'12px 0 0'}}>{clip.caption}</p></div>
  </Sequence>})}
  {!overlayOnly && <div style={{position:'absolute',bottom:0,height:5,background:'#ed6929',width:`${interpolate(frame,[0,5400],[0,100],{extrapolateRight:'clamp'})}%`}}/>}
  <div style={{position:'absolute',top:30,right:48,fontSize:16,background:'#090a09',padding:8}}>{transactions.length>=3?'MAINNET RECEIPTS VERIFIED':'REHEARSAL · MAINNET RECEIPTS PENDING'}</div>
 </AbsoluteFill>;
}
const defaults:Props={clips:[],transactions:[]};
const Root=()=> <Composition id="APP20Demo" component={Demo} width={1920} height={1080} fps={30} durationInFrames={5400} defaultProps={defaults}/>;
registerRoot(Root);
