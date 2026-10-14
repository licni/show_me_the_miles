import {ll} from './engine.mjs';

export const countyNote='使用者提供的縣鄉道樁號表；座標依既有資料比對採 TWD97／121°分帶，原檔無座標系統定義及調查日期。';
export const countyEstimateNote='依相鄰里程點連成的折線投影、內插，並非實測道路中心線；彎道可能有偏差。未通過檢核的缺點區間不推算，短距離端點延伸另行標示。';
export const countyGapEstimateNote='原始異常點未採用；依缺點兩側有效里程點及相鄰線形一致性，作短區間推估，並非實測樁位。';
export const countyBendEstimateNote='依轉角前後各兩段有效樁位方向及里程長度檢核，建立轉角折線推估；轉角並非實測中線或來源樁位。';
export const countyRoadShapeNote='依交通部道路向量線形，經前後樁位檢核及端點貼合後，按兩樁里程沿線內插；圖資有年代與位置誤差，仍屬推估。';
export const isCountyLine=line=>['county50','county-gap-estimate'].includes(line.sourceKind);

// Source records, including quarantined records, remain in private/. No renumbering.
export function prepareCounty(data){
 const byRoad={},lines=[],coverage=[];
 for(const p of data.points){
  if(p.status!=='accepted')continue;
  const kind=/^縣\d+[甲乙丙丁]?$/.test(p.road)?'縣道':/^屏\d+(?:-\d+)?$/.test(p.road)?'鄉道':null;
  if(!kind||(p.kind&&p.kind!==kind)||!Number.isInteger(p.m)||p.m<0||!Array.isArray(p.xy)||p.xy.length!==2||!p.xy.every(Number.isFinite))throw Error('Invalid local road source row '+p.row);
  (byRoad[p.road]??=[]).push({road:p.road,m:p.m,xy:p.xy,sourceKind:'county50',source:data.sourceLabel||'使用者提供，表內標示縣府提供',date:null,sign:null,dir:null,coordinateNote:countyNote});
 }
 for(const [road,points] of Object.entries(byRoad)){
  points.sort((a,b)=>a.m-b.m);
  const gaps=[];let run=[];
  function flush(){
   if(run.length>1){
    let s=0;const anchors=run.map((marker,i)=>{if(i)s+=Math.hypot(marker.xy[0]-run[i-1].xy[0],marker.xy[1]-run[i-1].xy[1]);return {s,d:0,xy:marker.xy,marker};});
    lines.push({road,kind:road.startsWith('屏')?'鄉道':'縣道',sourceKind:'county50',xy:run.map(p=>p.xy),ll:run.map(p=>ll(...p.xy)),length:s,anchors,direction:1});
   }run=[];
  }
  for(const p of points){
   const prev=run.at(-1);
   if(prev){
    const dm=p.m-prev.m,d=Math.hypot(p.xy[0]-prev.xy[0],p.xy[1]-prev.xy[1]);
    if(dm<=0)throw Error('Duplicate accepted county mileage: '+road+' '+p.m);
    if(dm>50||d<dm*.5||d>dm*1.5){gaps.push([prev.m,p.m]);flush();}
   }
   run.push(p);
  }
  flush();coverage.push({road,count:points.length,min:points[0].m,max:points.at(-1).m,gaps});
 }
 return {lines,byRoad,coverage};
}

// Derived estimates never alter the source records or create an official marker.
// Only an isolated quarantined 50m midpoint may be spanned, with both 50m
// shoulders supporting the same near-straight geometry and mileage scale.
export function prepareCountyRepairs(data,county){
 const lines=[],boundaries=[],sourceByRoad=new Map();
 const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const ratioOK=(a,b,dm)=>{const ratio=distance(a.xy,b.xy)/dm;return ratio>=.9&&ratio<=1.1;};
 const aligned=(a,b,c)=>{
  const dx=b.xy[0]-a.xy[0],dy=b.xy[1]-a.xy[1],ex=c.xy[0]-b.xy[0],ey=c.xy[1]-b.xy[1];
  return (dx*ex+dy*ey)/(Math.hypot(dx,dy)*Math.hypot(ex,ey))>=Math.cos(10*Math.PI/180);
 };
 for(const p of data.points){if(!sourceByRoad.has(p.road))sourceByRoad.set(p.road,[]);sourceByRoad.get(p.road).push(p);}
 for(const coverage of county.coverage){
  const points=county.byRoad[coverage.road],unresolved=new Map(),repaired=new Set();
  coverage.estimatedGaps=[];
  for(const [from,to] of coverage.gaps){
   const i=points.findIndex(p=>p.m===from),j=points.findIndex(p=>p.m===to);
   const before=points[i-1],a=points[i],b=points[j],after=points[j+1];
   const source=(sourceByRoad.get(coverage.road)||[]).filter(p=>p.m>from&&p.m<to);
   const isolated=to-from===100&&source.length===1&&source[0].m===from+50&&source[0].status==='quarantined';
   const supported=isolated&&before&&after&&a.m-before.m===50&&after.m-b.m===50&&ratioOK(before,a,50)&&ratioOK(a,b,100)&&ratioOK(b,after,50);
   if(supported&&aligned(before,a,b)&&aligned(a,b,after)){
    const length=distance(a.xy,b.xy),xy=[a.xy,b.xy];
    lines.push({road:coverage.road,kind:coverage.road.startsWith('屏')?'鄉道':'縣道',sourceKind:'county-gap-estimate',xy,ll:xy.map(p=>ll(...p)),length,direction:1,anchors:[{s:0,d:0,xy:a.xy,marker:a},{s:length,d:0,xy:b.xy,marker:b}]});
    coverage.estimatedGaps.push([from,to]);repaired.add(from);repaired.add(to);
   }else{
    const gap={from,to,xy:[a.xy,b.xy],guard:!!supported};
    unresolved.set(from,gap);unresolved.set(to,gap);
   }
  }
  for(const line of county.lines.filter(l=>l.road===coverage.road)){
   for(const [end,inside] of [[line.anchors[0],line.anchors[1]],[line.anchors.at(-1),line.anchors.at(-2)]]){
    if(repaired.has(end.marker.m))continue;
    const gap=unresolved.get(end.marker.m);
    const endpoint=!gap&&(end.marker.m===coverage.min||end.marker.m===coverage.max)?{m:end.marker.m,side:end.marker.m===coverage.min?'start':'end'}:null;
    boundaries.push({road:line.road,xy:end.xy,inside:inside.xy,reason:gap?'gap':'range',...(gap?{gap}:{}),...(endpoint?{endpoint}:{})});
   }
  }
 }
 return {lines,boundaries};
}

export function inferCounty(line,s){
 const a=line.anchors;
 if(s<0||s>line.length)return null;
 let before=a.filter(p=>p.s<=s).at(-1),after=a.find(p=>p.s>=s);
 if(!before||!after)return null;
 if(before===after)return {m:before.marker.m,refs:[before],method:'里程點折線投影',distance:0};
 return {m:before.marker.m+(s-before.s)*(after.marker.m-before.marker.m)/(after.s-before.s),refs:[before,after],method:before.roadShape?'道路線形校準內插':before.bend?'轉角折線推估':line.sourceKind==='county-gap-estimate'?'缺點區間兩端推估':'相鄰里程點折線內插',distance:Math.min(s-before.s,after.s-s),...(before.roadShape?{sourceKind:'county-road-shape-estimate'}:before.bend?{sourceKind:'county-bend-estimate'}:{})};
}

// Do not clamp a position beyond a coverage/gap boundary back to the endpoint.
export function beyondCountyEnd(q,line,p){
 const xy=line.xy;
 const along=(a,b)=>(q[0]-a[0])*(b[0]-a[0])+(q[1]-a[1])*(b[1]-a[1]);
 return (p.s<1e-7&&along(xy[0],xy[1])<-1e-5)||(line.length-p.s<1e-7&&along(xy.at(-1),xy.at(-2))<-1e-5);
}
