// Clip each source segment independently; never connect separate valid runs
// across a quarantined point, unsupported gap, or an excursion outside the box.
function clip(a,b,box){
 let lo=0,hi=1;
 for(let axis=0;axis<2;axis++){
  const delta=b[axis]-a[axis];
  if(delta===0){if(a[axis]<box[axis]||a[axis]>box[axis+2])return null;continue;}
  const u=(box[axis]-a[axis])/delta,v=(box[axis+2]-a[axis])/delta;
  lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));
  if(lo>=hi)return null;
 }
 return [lo===0?a:a.map((v,i)=>v+(b[i]-v)*lo),hi===1?b:a.map((v,i)=>v+(b[i]-v)*hi)];
}
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
export function localMapLines(source,lon,lat){
 const d=.018,box=[lon-d,lat-d,lon+d,lat+d],cos=Math.cos(lat*Math.PI/180),chunks=[];
 const distance=(a,b)=>{
  const x=(a[0]-lon)*cos,y=a[1]-lat,dx=(b[0]-a[0])*cos,dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)));
  return (x+t*dx)**2+(y+t*dy)**2;
 };
 for(const l of source){
  const b=l.bbox;if(b&&(b[0]>box[2]||b[2]<box[0]||b[1]>box[3]||b[3]<box[1]))continue;
  let points=[],nearest=Infinity;
  const flush=()=>{if(points.length>1)chunks.push({road:l.road,kind:l.kind,ll:points,nearest});points=[];nearest=Infinity;};
  for(let i=1;i<l.ll.length;i++){
   const segment=clip(l.ll[i-1],l.ll[i],box);
   if(!segment){flush();continue;}
   const [a,z]=segment;
   if(points.length&&!same(points.at(-1),a))flush();
   if(!points.length)points.push(a);
   if(!same(points.at(-1),z))points.push(z);
   nearest=Math.min(nearest,distance(a,z));
   // Small contiguous chunks prevent a long early road consuming the budget
   // before a road close to the map centre can be shown.
   if(points.length>=64)flush();
  }
  flush();
 }
 chunks.sort((a,b)=>a.nearest-b.nearest);
 const lines=[];let vertices=0;
 for(const c of chunks){
  if(vertices+c.ll.length>2500)continue;
  lines.push({road:c.road,kind:c.kind,ll:c.ll});vertices+=c.ll.length;
 }
 return lines;
}

// Display-only levels, prepared once during build. Never attach anchors or mileage.
export function prepareReferenceLevels(source){
 const simplify=(points,metres)=>{
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]],limit=metres*metres;
  while(stack.length){
   const [a,b]=stack.pop(),p=points[a],q=points[b];let far=limit,index=-1;
   const dx=(q[0]-p[0])*103000,dy=(q[1]-p[1])*111000,den=dx*dx+dy*dy;
   for(let i=a+1;i<b;i++){
    const x=(points[i][0]-p[0])*103000,y=(points[i][1]-p[1])*111000,t=den?Math.max(0,Math.min(1,(x*dx+y*dy)/den)):0,d=(x-t*dx)**2+(y-t*dy)**2;
    if(d>far){far=d;index=i;}
   }
   if(index!==-1){keep.add(index);stack.push([a,index],[index,b]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
 };
 return [3,20,100].map(tolerance=>({tolerance,lines:source.map(l=>({road:l.road,kind:l.kind,bbox:l.bbox,ll:simplify(l.ll,tolerance)}))}));
}
export function viewportMapLines(levels,bounds,overview=null){
 if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||bounds[0]<-180||bounds[2]>180||bounds[1]<-90||bounds[3]>90)throw Error('地圖範圍無效。');
 const box=[Math.max(120,bounds[0]),Math.max(21.7,bounds[1]),Math.min(121.5,bounds[2]),Math.min(23,bounds[3])];
 if(box[0]>=box[2]||box[1]>=box[3])return {lines:[],bounds:box,tolerance:0};
 if(overview&&box.every((v,i)=>v===[120,21.7,121.5,23][i]))return overview;
 const span=Math.max(box[2]-box[0],box[3]-box[1]);let level=span>.35?2:span>.08?1:0;
 for(;level<levels.length;level++){
  const lines=[];
  for(const l of levels[level].lines){
   const b=l.bbox;if(b&&(b[0]>box[2]||b[2]<box[0]||b[1]>box[3]||b[3]<box[1]))continue;
   let points=[];
   const flush=()=>{if(points.length>1)lines.push({road:l.road,kind:l.kind,ll:points.map(p=>p.map(n=>Number(n.toFixed(6))))});points=[];};
   for(let i=1;i<l.ll.length;i++){
    const segment=clip(l.ll[i-1],l.ll[i],box);if(!segment){flush();continue;}
    const [a,z]=segment;if(points.length&&!same(points.at(-1),a))flush();if(!points.length)points.push(a);if(!same(points.at(-1),z))points.push(z);
   }
   flush();
  }
  if(lines.reduce((n,l)=>n+l.ll.length,0)<=20000)return {lines,bounds:box,tolerance:levels[level].tolerance};
 }
 throw Error('此畫面參考線過多，請放大後重試。');
}
