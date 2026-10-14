import {at,ll} from './engine.mjs';
import {isCountyLine} from './county.mjs';
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const eps=1e-5;
function spansFor(model,road){
 const spans=[];
 for(const line of [...(model.centerlines||[]),...(model.lines||[]).filter(isCountyLine)]){
  if(line.road!==road)continue;
  const aa=line.anchors||[];
  for(let i=1;i<aa.length;i++){
   const a=aa[i-1],b=aa[i],dm=b.marker.m-a.marker.m,ds=b.s-a.s;if(!dm||ds<=eps)continue;
   const make=(s0,s1,kind)=>{const m0=a.marker.m+(s0-a.s)*dm/ds,m1=a.marker.m+(s1-a.s)*dm/ds;spans.push({line,s0,s1,m0,m1,lo:Math.min(m0,m1),hi:Math.max(m0,m1),kind});};
   make(a.s,b.s,line.sourceKind==='province-centerline'?'共用中心線推估':a.roadShape?'道路線形推估':a.bend?'轉角推估':line.sourceKind==='county-gap-estimate'?'缺點推估':'樁位內插推估');
   if(i===1&&line.extrapolateStart)make(Math.max(0,a.s-1200),a.s,'中心線末段推估');
   if(i===aa.length-1&&line.extrapolateEnd)make(b.s,Math.min(line.length,b.s+1200),'中心線末段推估');
  }
 }
 for(const line of model.endpointExtensions||[]){if(line.road!==road)continue;const m0=line.marker.m,m1=m0+line.sign*line.length;spans.push({line,s0:0,s1:line.length,m0,m1,lo:Math.min(m0,m1),hi:Math.max(m0,m1),kind:'端點延伸推估'});}
 return spans;
}
const station=(span,m)=>Math.max(0,Math.min(span.line.length,span.s0+(m-span.m0)*(span.s1-span.s0)/(span.m1-span.m0)));
function slice(span,from,to){
 const start=station(span,from),end=station(span,to),low=Math.min(start,end),high=Math.max(start,end),points=[at(span.line,low)];let s=0;
 for(let i=1;i<span.line.xy.length;i++){s+=dist(span.line.xy[i-1],span.line.xy[i]);if(s>low+eps&&s<high-eps)points.push(span.line.xy[i]);}
 points.push(at(span.line,high));return start<=end?points:points.reverse();
}
function simplify(points,tolerance){
 if(points.length<3)return points;
 const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]],t2=tolerance*tolerance;
 while(stack.length){const [a,b]=stack.pop(),p=points[a],q=points[b],dx=q[0]-p[0],dy=q[1]-p[1],len=dx*dx+dy*dy;let best=t2,index=-1;
  for(let i=a+1;i<b;i++){const r=points[i],t=len?Math.max(0,Math.min(1,((r[0]-p[0])*dx+(r[1]-p[1])*dy)/len)):0,d=(r[0]-p[0]-t*dx)**2+(r[1]-p[1]-t*dy)**2;if(d>best){best=d;index=i;}}
  if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}
 }
 return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
export function roadSegment(model,road,from,to){
 if(!Object.hasOwn(model.byRoad,road))throw Error('請選擇有效道路。');
 if(![from,to].every(n=>Number.isInteger(n)&&n>=0&&n<=600000)||from===to)throw Error('請提供不同的起迄樁號，範圍為0至600公里。');
 if(Math.abs(to-from)>50000)throw Error('單次最多標示50公里，請分段查詢。');
 const low=Math.min(from,to),high=Math.max(from,to),spans=spansFor(model,road).filter(s=>s.hi>low+eps&&s.lo<high-eps);
 const cuts=[low,high,...spans.flatMap(s=>[Math.max(low,s.lo),Math.min(high,s.hi)])].sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>eps);
 const parts=[],gaps=[],kinds=new Set();let length=0,start=null,end=null;
 const gap=(a,b,reason)=>{const last=gaps.at(-1);if(last&&last.reason===reason&&Math.abs(last.to-a)<eps)last.to=b;else gaps.push({from:a,to:b,reason});};
 for(let i=1;i<cuts.length;i++){
  const a=cuts[i-1],b=cuts[i],mid=(a+b)/2,candidates=spans.filter(s=>mid>s.lo-eps&&mid<s.hi+eps);
  if(!candidates.length){gap(a,b,'缺少可用道路線形');continue;}
  const candidate=candidates[0],p=slice(candidate,a,b);
  // Alternative branches sharing mileage are not silently joined or selected.
  if(candidates.slice(1).some(s=>[a,(3*a+b)/4,mid,(a+3*b)/4,b].some(m=>dist(at(candidate.line,station(candidate,m)),at(s.line,station(s,m)))>2))){gap(a,b,'同里程有不同路徑，無法唯一判定');continue;}
  const partLength=p.slice(1).reduce((n,q,j)=>n+dist(p[j],q),0);length+=partLength;kinds.add(candidate.kind);
  if(Math.abs(a-low)<eps)start={m:low,xy:p[0],ll:ll(...p[0])};if(Math.abs(b-high)<eps)end={m:high,xy:p.at(-1),ll:ll(...p.at(-1))};
  const prev=parts.at(-1);
  if(prev&&Math.abs(prev.to-a)<eps&&dist(prev.xy.at(-1),p[0])<.05){prev.xy.push(...p.slice(1));prev.to=b;}
  else{if(prev&&Math.abs(prev.to-a)<eps)gap(a,a,'線形接續不連續');parts.push({from:a,to:b,xy:p});}
 }
 let tolerance=.15,display=parts.map(p=>({...p,xy:simplify(p.xy,tolerance)}));
 while(display.reduce((n,p)=>n+p.xy.length,0)>5000&&tolerance<256){tolerance*=2;display=parts.map(p=>({...p,xy:simplify(p.xy,tolerance)}));}
 if(display.length>128||display.reduce((n,p)=>n+p.xy.length,0)>5000)throw Error('此區間線形過於分散，請縮短查詢範圍。');
 const complete=gaps.length===0&&!!start&&!!end;
 if(from>to){[start,end]=[end,start];display.reverse();for(const part of display){part.xy.reverse();[part.from,part.to]=[part.to,part.from];}}
 const coverage=model.byRoad[road].reduce((r,p)=>[Math.min(r[0],p.m),Math.max(r[1],p.m)],[Infinity,-Infinity]);
 return {road,from,to,mileageLength:Math.abs(to-from),complete,geometryLength:complete?length:null,coveredGeometryLength:length,start,end,parts:display.map(p=>({from:p.from,to:p.to,ll:p.xy.map(q=>ll(...q))})),gaps,kinds:[...kinds],displayTolerance:tolerance,coverage};
}
