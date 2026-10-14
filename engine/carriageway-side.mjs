import {roadSegment} from './segments.mjs';
import {tm,ll,project} from './engine.mjs';

// Display-only offset. Mileage, original geometry, sharing and lengths stay unchanged.
// Taiwan right-hand traffic: right of increasing mileage is 順樁向.
const OFFSET=6;
export function validateSide(side){
 if(side!==undefined&&!['forward','backward'].includes(side))throw Error('側別請指定順樁向或逆樁向。');
 return side;
}
export function offsetSideLine(points,side,increasing=true){
 const xy=points.map(p=>tm(...p)),sign=(side==='forward'?1:-1)*(increasing?1:-1);
 const normal=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);return d>1e-6?[dy/d,-dx/d]:null;};
 return xy.map((p,i)=>{
  let prev=i-1,next=i+1;
  while(prev>=0&&Math.hypot(p[0]-xy[prev][0],p[1]-xy[prev][1])<1e-6)prev--;
  while(next<xy.length&&Math.hypot(p[0]-xy[next][0],p[1]-xy[next][1])<1e-6)next++;
  const a=prev>=0?normal(xy[prev],p):null,b=next<xy.length?normal(p,xy[next]):null;
  let n=a&&b?[a[0]+b[0],a[1]+b[1]]:a||b;
  if(!n)return points[i];
  let length=Math.hypot(...n);if(length<1e-6){n=b||a;length=1;}
  return ll(p[0]+sign*OFFSET*n[0]/length,p[1]+sign*OFFSET*n[1]/length);
 });
}
const metadata=side=>({direction:side,label:side==='forward'?'順樁向側':'逆樁向側',note:'側別以中心線左右偏移示意，非實際車道或施工座標；里程與長度仍依中心線計算。'});
export function segmentSide(segment,side){
 const parts=segment.parts.map(p=>({...p,ll:offsetSideLine(p.ll,side,p.to>p.from)}));
 return {...metadata(side),parts,start:segment.start&&parts.length?{...segment.start,ll:parts[0].ll[0]}:null,end:segment.end&&parts.length?{...segment.end,ll:parts.at(-1).ll.at(-1)}:null};
}
export function pointSide(model,road,m,xy,side){
 const meta=metadata(side),range=roadSegment(model,road,Math.max(0,m-5),Math.min(600000,m+5));
 // Require one continuous, unambiguous local segment supporting this point.
 const matches=range.parts.filter(p=>p.from<=m&&p.to>=m);
 if(matches.length!==1||range.gaps.some(g=>g.from<=m&&g.to>=m))return {...meta,note:'此處缺少連續且可判定方向的中心線，僅註記側別，未偏移標記。'};
 const part=matches[0],points=part.ll.map(p=>tm(...p));
 if(project(xy,points).d>40)return {...meta,note:'此資料點無法唯一對應附近中心線，僅註記側別，未偏移標記。'};
 // Interpolate at the same mileage in the short centerline span, never on a raw marker side.
 const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
 let target=lengths.reduce((a,b)=>a+b,0)*(m-part.from)/(part.to-part.from),center=points[0],tangent;
 for(let i=0;i<lengths.length;i++){
  const length=lengths[i];if(length<=1e-6)continue;
  if(target<=length||i===lengths.length-1){const a=points[i],b=points[i+1],t=Math.max(0,Math.min(1,target/length));center=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];tangent=[(b[0]-a[0])/length,(b[1]-a[1])/length];break;}
  target-=length;
 }
 if(!tangent)return {...meta,note:'此處無法判定中心線方向，僅註記側別，未偏移標記。'};
 const sign=side==='forward'?1:-1;
 return {...meta,ll:ll(center[0]+sign*OFFSET*tangent[1],center[1]-sign*OFFSET*tangent[0])};
}
