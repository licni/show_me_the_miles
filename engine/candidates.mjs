import {locate,project,tm,ll,at} from './engine.mjs';
import {beyondCountyEnd as beyondLineEnd} from './county.mjs';
import {endpointPositionCandidates} from './county-endpoints.mjs';

// Keep one result per road, so parallel lanes do not hide another road at a junction.
export function positionCandidates(model,xy,road=''){
 const [x,y]=xy,[lon,lat]=ll(...xy);
 const lines=model.lines.filter(l=>(!road||l.road===road)&&l.bbox[0]-60<=x&&l.bbox[2]+60>=x&&l.bbox[1]-60<=y&&l.bbox[3]+60>=y);
 const byRoad=new Map();
 for(const r of locate({lines,centerlines:model.centerlines,centerlineRamps:model.centerlineRamps,provinceAxes:model.provinceAxes},xy,road))if(!byRoad.has(r.line.road))byRoad.set(r.line.road,r);
 // A source point without a supported adjacent interval is still an exact
 // record. Recognize only the supplied coordinate (numerical tolerance), not
 // a radius in which that point could fabricate road geometry or mileage.
 for(const marker of model.localIsolatedMarkers||[]){
  if(road&&marker.road!==road)continue;
  const d=Math.hypot(x-marker.xy[0],y-marker.xy[1]);
  if(d<=1e-7)byRoad.set(marker.road,{m:marker.m,xy:marker.xy,d,marker,refs:[{marker}],distance:0,method:'來源表里程點',line:{road:marker.road,sourceKind:'county50'}});
 }
 const references=new Map();
 // Public reference geometry is not mileage data. Missing mileage stays null.
 for(const l of model.mapLines||[]){
  if(!l.road||(road&&l.road!==road))continue;
  const b=l.bbox;
  // ~100m bounding margin, followed by the exact projected 60m distance check.
  if(b&&(lon<b[0]-.001||lon>b[2]+.001||lat<b[1]-.001||lat>b[3]+.001))continue;
  const pts=l.xy||l.ll.map(p=>tm(...p)),length=l.length??pts.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);
  if(pts.length<2||!length)continue;
  const line={road:l.road,kind:l.kind,sourceKind:'reference-only',xy:pts,length},p=project(xy,pts);
  if(p.d>60)continue;
  const endpoint=beyondLineEnd(xy,line,p);
  if(!references.has(l.road)||p.d<references.get(l.road).d)references.set(l.road,{...p,line,m:null,refs:[],distance:null,method:endpoint?'最近參考線端點':'參考線投影',...(endpoint?{distanceKind:'endpoint',notice:'reference-end'}:{})});
 }
 for(const [name,r] of references){
  const calibrated=byRoad.get(name);
  // A closer uncalibrated province fragment is evidence against snapping onto a
  // distant calibrated fragment. County mileage keeps the user's newer geometry.
  if(!calibrated){byRoad.set(name,r);continue;}
  const nearerUncalibrated=(model.provinceAxes||calibrated.line.sourceKind!=='province-centerline')&&calibrated.sourceKind!=='province-ramp-estimate'&&r.line.kind==='省道'&&r.distanceKind!=='endpoint'&&calibrated.d>r.d+2;
  if(!nearerUncalibrated)continue;
  // At a spur junction the physical main carriageway can be closer than its
  // shared axis. Only an accepted paired portion of this very calibrated axis
  // can establish membership; it never supplies a separate mileage estimate.
  const onAcceptedCarriageway=(model.centerlineCorridors||[]).some(c=>{
   if(c.road!==name||!c.axisIds.some(id=>calibrated.line.axisSources?.includes(id)))return false;
   const margin=r.d+.25,b=c.bbox;
   if(b&&(x<b[0]-margin||x>b[2]+margin||y<b[1]-margin||y>b[3]+margin))return false;
   const p=project(xy,c.xy);
   if(p.d>margin||beyondLineEnd(xy,c,p))return false;
   // The same source axis may contain an uncalibrated interval. Membership on
   // a long paired road cannot borrow a farther calibrated portion across it.
   const mainline=(model.mapLines||[]).filter(l=>l.road===name&&c.axisIds.includes(l.axisId)).map(l=>project(xy,l.xy||l.ll.map(p=>tm(...p)))).sort((a,b)=>a.d-b.d)[0];
   return mainline&&Math.hypot(mainline.xy[0]-calibrated.xy[0],mainline.xy[1]-calibrated.xy[1])<.1;
  });
  if(!onAcceptedCarriageway)byRoad.set(name,r);
 }
 for(const boundary of model.countyBoundaries||[]){
  if(road&&boundary.road!==road)continue;
  const dx=x-boundary.xy[0],dy=y-boundary.xy[1],d=Math.hypot(dx,dy);
  if(d>60||dx*(boundary.inside[0]-boundary.xy[0])+dy*(boundary.inside[1]-boundary.xy[1])>=-1e-5)continue;
  const previous=byRoad.get(boundary.road);
  const hint={m:null,d,xy:boundary.xy,refs:[],distance:null,distanceKind:'endpoint',notice:boundary.reason,method:'最近有效資料端點',line:{road:boundary.road,sourceKind:'county-boundary'}};
  // A nearby known data endpoint is useful without claiming the query itself
  // has that mileage. Valid short extensions are considered separately below.
  if(boundary.reason==='range'&&boundary.endpoint&&d<=15)hint.nearbyEndpoint={...boundary.endpoint};
  // A supported short gap may invalidate a farther same-road projection, but
  // its chord is only an uncertainty mask. Never report that chord as a road.
  let masksFarther=false;
  if(previous&&Number.isFinite(previous.m)&&boundary.gap?.guard){
   const gap=boundary.gap,projection=project(xy,gap.xy),length=Math.hypot(gap.xy[1][0]-gap.xy[0][0],gap.xy[1][1]-gap.xy[0][1]);
   masksFarther=gap.xy.every(p=>Math.hypot(x-p[0],y-p[1])<=60)&&projection.s>0&&projection.s<length&&projection.d+2<previous.d;
  }
  if(!previous||masksFarther||(!Number.isFinite(previous.m)&&d<previous.d))byRoad.set(boundary.road,hint);
  else if(!Number.isFinite(previous.m)&&!previous.notice)previous.notice=boundary.reason;
 }
 for(const extension of endpointPositionCandidates(model,xy,road)){
  const previous=byRoad.get(extension.line.road);
  if(!previous||!Number.isFinite(previous.m))byRoad.set(extension.line.road,extension);
 }
 return [...byRoad.values()].sort((a,b)=>a.d-b.d).slice(0,3);
}

// Preserve actual bend vertices, including at the projection, instead of drawing
// chords between regularly sampled positions. Narrow the window if it is dense.
export function localGeometry(line,s){
 let radius=250,points;
 do{
  const start=Math.max(0,s-radius),end=Math.min(line.length,s+radius);
  points=[at(line,start)];let distance=0;
  for(let i=1;i<line.xy.length;i++){
   distance+=Math.hypot(line.xy[i][0]-line.xy[i-1][0],line.xy[i][1]-line.xy[i-1][1]);
   if(distance>start&&distance<end)points.push(line.xy[i]);
  }
  points.push(at(line,end));radius/=2;
 }while(points.length>82&&radius>1e-7);
 return points;
}

export function distinctLocations(results){
 const chosen=[];
 for(const r of results){
  if(chosen.every(p=>Math.hypot(p.xy[0]-r.xy[0],p.xy[1]-r.xy[1])>2))chosen.push(r);
  if(chosen.length===3)break;
 }
 return chosen;
}
